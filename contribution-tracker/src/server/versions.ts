import { desc, eq } from "drizzle-orm";
import { parseStudioConfig, type CalcParams, type StudioConfig } from "@/domain/config";
import type { DbOrTx } from "@/db";
import { categoryTemplates, configVersions, libraryVersions, members, projects, taskTemplates } from "@/db/schema";
import { allApproved, castVote } from "./approvals";
import type { Ctx } from "./context";
import { iso } from "./context";
import { assertProjectOpen, audit, loadProject, nonEmpty, requireActor } from "./common";
import { DomainError } from "./errors";
import { validateLibrary } from "./seedImport";

/*
 * The task library and the rules (config) are versioned. Edits happen in a draft; a draft becomes
 * active only when every active partner approves it. Projects keep the version they were planned with.
 */

const activeMemberIds = (tx: DbOrTx) =>
  tx
    .select({ id: members.id })
    .from(members)
    .where(eq(members.active, true))
    .all()
    .map((m) => m.id);

// ---------- task library ----------

export function createDraftLibraryVersion(ctx: Ctx, note: string): { versionId: number } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const open = tx.select().from(libraryVersions).all().find((v) => v.status === "draft" || v.status === "pending");
    if (open) throw new DomainError("conflict", `Library v${open.version} is already being edited`);
    const active = tx.select().from(libraryVersions).where(eq(libraryVersions.status, "active")).get();
    if (!active) throw new DomainError("conflict", "No active library");
    const last = tx.select().from(libraryVersions).orderBy(desc(libraryVersions.version)).get();
    const version = (last?.version ?? 0) + 1;
    const id = tx
      .insert(libraryVersions)
      .values({ version, status: "draft", note: note.trim() || `Edit of v${active.version}`, source: "edit", createdBy: actor, createdAt: iso(ctx.now) })
      .returning({ id: libraryVersions.id })
      .get().id;
    const cats = tx.select().from(categoryTemplates).where(eq(categoryTemplates.libraryVersionId, active.id)).all();
    tx.insert(categoryTemplates)
      .values(cats.map(({ id: _id, ...c }) => ({ ...c, libraryVersionId: id })))
      .run();
    const tpls = tx.select().from(taskTemplates).where(eq(taskTemplates.libraryVersionId, active.id)).all();
    for (let i = 0; i < tpls.length; i += 50) {
      tx.insert(taskTemplates)
        .values(tpls.slice(i, i + 50).map(({ id: _id, ...t }) => ({ ...t, libraryVersionId: id })))
        .run();
    }
    audit(tx, ctx, "library.draft", "library_version", id, null, undefined, { version, from: active.version });
    return { versionId: id };
  });
}

function loadLibraryVersion(tx: DbOrTx, id: number) {
  const v = tx.select().from(libraryVersions).where(eq(libraryVersions.id, id)).get();
  if (!v) throw new DomainError("not_found", "Library version not found");
  return v;
}

export interface TemplatePatch {
  name?: string;
  description?: string;
  defaultPoints?: number;
  complexity?: string;
  effortRange?: string;
  classification?: string;
  evidenceExpected?: string;
  defaultOwnerRole?: string;
  inStandardProject?: string;
}

export function updateDraftTemplate(ctx: Ctx, templateId: number, patch: TemplatePatch) {
  requireActor(ctx);
  ctx.db.transaction((tx) => {
    const t = tx.select().from(taskTemplates).where(eq(taskTemplates.id, templateId)).get();
    if (!t) throw new DomainError("not_found", "Template not found");
    if (loadLibraryVersion(tx, t.libraryVersionId).status !== "draft") throw new DomainError("locked", "Only a draft library version can be edited");
    if (patch.defaultPoints !== undefined && !(Number.isInteger(patch.defaultPoints) && patch.defaultPoints >= 1 && patch.defaultPoints <= 200)) {
      throw new DomainError("invalid", "Default points must be a whole number from 1 to 200");
    }
    const next = { ...patch, name: patch.name !== undefined ? nonEmpty(patch.name, "Name") : t.name };
    tx.update(taskTemplates).set(next).where(eq(taskTemplates.id, templateId)).run();
    audit(tx, ctx, "library.edit_template", "task_template", templateId, null, t, next);
  });
}

export function submitLibraryVersion(ctx: Ctx, versionId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const v = loadLibraryVersion(tx, versionId);
    if (v.status !== "draft") throw new DomainError("conflict", "Only drafts can be submitted");
    const tpls = tx.select().from(taskTemplates).where(eq(taskTemplates.libraryVersionId, v.id)).all();
    validateLibrary(tpls.map((t) => ({ code: t.code, dependsOn: t.dependsOn })), []);
    tx.update(libraryVersions).set({ status: "pending" }).where(eq(libraryVersions.id, v.id)).run();
    castVote(tx, { subjectType: "library_version", subjectId: v.id, round: v.round, memberId: actor, decision: "approve", now: ctx.now, label: "library version" });
    audit(tx, ctx, "library.submit", "library_version", v.id, null, { status: "draft" }, { status: "pending" });
    maybeActivateLibrary(tx, ctx, v.id);
  });
}

function maybeActivateLibrary(tx: DbOrTx, ctx: Ctx, versionId: number) {
  const v = loadLibraryVersion(tx, versionId);
  if (!allApproved(tx, "library_version", v.id, v.round, activeMemberIds(tx))) return;
  tx.update(libraryVersions).set({ status: "superseded" }).where(eq(libraryVersions.status, "active")).run();
  tx.update(libraryVersions).set({ status: "active", activatedAt: iso(ctx.now) }).where(eq(libraryVersions.id, v.id)).run();
  audit(tx, ctx, "library.activate", "library_version", v.id, null, { status: "pending" }, { status: "active", version: v.version });
}

export function decideLibraryVersion(ctx: Ctx, versionId: number, decision: "approve" | "reject", note = "") {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const v = loadLibraryVersion(tx, versionId);
    if (v.status !== "pending") throw new DomainError("conflict", "This version is not waiting for approval");
    castVote(tx, { subjectType: "library_version", subjectId: v.id, round: v.round, memberId: actor, decision, note, now: ctx.now, label: "library version" });
    if (decision === "reject") {
      tx.update(libraryVersions).set({ status: "draft", round: v.round + 1 }).where(eq(libraryVersions.id, v.id)).run();
      audit(tx, ctx, "library.reject", "library_version", v.id, null, { status: "pending" }, { status: "draft", note });
      return;
    }
    audit(tx, ctx, "library.approve", "library_version", v.id, null, undefined, { round: v.round });
    maybeActivateLibrary(tx, ctx, v.id);
  });
}

// ---------- rules (config) ----------

export function activeConfig(tx: DbOrTx): { id: number; version: number; data: StudioConfig } {
  const row = tx.select().from(configVersions).where(eq(configVersions.status, "active")).get();
  if (!row) throw new DomainError("conflict", "No active rules");
  return { id: row.id, version: row.version, data: parseStudioConfig(row.data) };
}

export function createDraftConfig(ctx: Ctx, note: string): { versionId: number } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const open = tx.select().from(configVersions).all().find((v) => v.status === "draft" || v.status === "pending");
    if (open) throw new DomainError("conflict", `Rules v${open.version} are already being edited`);
    const active = activeConfig(tx);
    const last = tx.select().from(configVersions).orderBy(desc(configVersions.version)).get();
    const version = (last?.version ?? 0) + 1;
    const id = tx
      .insert(configVersions)
      .values({ version, status: "draft", data: active.data, note: note.trim() || `Edit of v${active.version}`, createdBy: actor, createdAt: iso(ctx.now) })
      .returning({ id: configVersions.id })
      .get().id;
    audit(tx, ctx, "config.draft", "config_version", id, null, undefined, { version });
    return { versionId: id };
  });
}

export interface ConfigPatch {
  calculation?: Partial<CalcParams>;
  communicationPoints?: Record<string, { lead_points: number; second_attendee_points: number }>;
}

export function updateDraftConfig(ctx: Ctx, versionId: number, patch: ConfigPatch) {
  requireActor(ctx);
  ctx.db.transaction((tx) => {
    const v = tx.select().from(configVersions).where(eq(configVersions.id, versionId)).get();
    if (!v) throw new DomainError("not_found", "Rules version not found");
    if (v.status !== "draft") throw new DomainError("locked", "Only draft rules can be edited");
    const data = structuredClone(v.data);
    if (patch.calculation) data.calculation = { ...data.calculation, ...patch.calculation };
    if (patch.communicationPoints) {
      data.communication_types = data.communication_types.map((c) => (patch.communicationPoints?.[c.code] ? { ...c, ...patch.communicationPoints[c.code] } : c));
    }
    let parsed: StudioConfig;
    try {
      parsed = parseStudioConfig(data);
    } catch (e) {
      const issues = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues;
      throw new DomainError("invalid", issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? "Invalid rules");
    }
    tx.update(configVersions).set({ data: parsed }).where(eq(configVersions.id, versionId)).run();
    audit(tx, ctx, "config.edit", "config_version", versionId, null, v.data.calculation, parsed.calculation);
  });
}

function maybeActivateConfig(tx: DbOrTx, ctx: Ctx, versionId: number) {
  const v = tx.select().from(configVersions).where(eq(configVersions.id, versionId)).get();
  if (!v || !allApproved(tx, "config_version", v.id, v.round, activeMemberIds(tx))) return;
  tx.update(configVersions).set({ status: "superseded" }).where(eq(configVersions.status, "active")).run();
  tx.update(configVersions).set({ status: "active", activatedAt: iso(ctx.now) }).where(eq(configVersions.id, v.id)).run();
  audit(tx, ctx, "config.activate", "config_version", v.id, null, { status: "pending" }, { status: "active", version: v.version });
}

export function submitConfig(ctx: Ctx, versionId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const v = tx.select().from(configVersions).where(eq(configVersions.id, versionId)).get();
    if (!v || v.status !== "draft") throw new DomainError("conflict", "Only draft rules can be submitted");
    tx.update(configVersions).set({ status: "pending" }).where(eq(configVersions.id, v.id)).run();
    castVote(tx, { subjectType: "config_version", subjectId: v.id, round: v.round, memberId: actor, decision: "approve", now: ctx.now, label: "rules version" });
    audit(tx, ctx, "config.submit", "config_version", v.id, null, { status: "draft" }, { status: "pending" });
    maybeActivateConfig(tx, ctx, v.id);
  });
}

export function decideConfig(ctx: Ctx, versionId: number, decision: "approve" | "reject", note = "") {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const v = tx.select().from(configVersions).where(eq(configVersions.id, versionId)).get();
    if (!v || v.status !== "pending") throw new DomainError("conflict", "These rules are not waiting for approval");
    castVote(tx, { subjectType: "config_version", subjectId: v.id, round: v.round, memberId: actor, decision, note, now: ctx.now, label: "rules version" });
    if (decision === "reject") {
      tx.update(configVersions).set({ status: "draft", round: v.round + 1 }).where(eq(configVersions.id, v.id)).run();
      audit(tx, ctx, "config.reject", "config_version", v.id, null, { status: "pending" }, { status: "draft", note });
      return;
    }
    audit(tx, ctx, "config.approve", "config_version", v.id, null, undefined, { round: v.round });
    maybeActivateConfig(tx, ctx, v.id);
  });
}

/** Decision D16: while a plan is still a draft, a project can move to the newest rules and library. */
export function repinProject(ctx: Ctx, projectId: number) {
  requireActor(ctx);
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    if (p.planStatus !== "draft") throw new DomainError("locked", "The plan is locked; the project keeps the rules it was planned with");
    const cfg = activeConfig(tx);
    tx.update(projects).set({ configVersionId: cfg.id, updatedAt: iso(ctx.now) }).where(eq(projects.id, p.id)).run();
    audit(tx, ctx, "project.repin_rules", "project", p.id, p.id, { configVersionId: p.configVersionId }, { configVersionId: cfg.id });
  });
}
