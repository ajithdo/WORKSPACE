import { and, desc, eq, like } from "drizzle-orm";
import { suggestAssignments } from "@/domain/assignment";
import type { StudioConfig } from "@/domain/config";
import { selectTemplatesForType } from "@/domain/library";
import type { ProjectKind, ProjectType } from "@/domain/types";
import { PROJECT_TYPES } from "@/domain/types";
import type { DbOrTx } from "@/db";
import {
  categoryTemplates,
  clientApprovals,
  clients,
  configVersions,
  handoverItems,
  libraryVersions,
  members,
  projectMembers,
  projects,
  studio,
  taskContributions,
  taskInstances,
  taskTemplates,
  type PaymentScheduleEntry,
} from "@/db/schema";
import type { Ctx } from "./context";
import { addHours, iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, configById, loadProject, nonEmpty, projectMemberIds, requireActor, type ProjectRow } from "./common";
import { DomainError } from "./errors";

export interface CreateProjectInput {
  name: string;
  kind: ProjectKind;
  projectType: ProjectType;
  multilingual?: boolean;
  clientId?: number | null;
  newClient?: { businessName: string; stateCode: string; gstin?: string; contactName?: string; contactEmail?: string; contactPhone?: string } | null;
  originatedBy?: number | null;
  quotedAmountExGst?: number;
  placeOfSupplyState?: string;
  startDate?: string | null;
  targetLaunchDate?: string | null;
  memberIds?: number[];
  msmeApplicable?: boolean;
  deemedAcceptanceClause?: boolean;
  deemedAcceptanceDays?: number | null;
  notes?: string;
}

const KIND_TYPES: Record<ProjectKind, ProjectType[]> = {
  client: ["brochure", "cms", "ecommerce", "booking", "custom"],
  studio: ["studio"],
  maintenance: ["maintenance"],
};

type TemplateRow = typeof taskTemplates.$inferSelect;

export function activeVersionIds(tx: DbOrTx): { libraryVersionId: number; configVersionId: number } {
  const lib = tx.select({ id: libraryVersions.id }).from(libraryVersions).where(eq(libraryVersions.status, "active")).get();
  const cfg = tx.select({ id: configVersions.id }).from(configVersions).where(eq(configVersions.status, "active")).get();
  if (!lib || !cfg) throw new DomainError("conflict", "The task library has not been imported yet");
  return { libraryVersionId: lib.id, configVersionId: cfg.id };
}

const GSTIN = /^[0-9]{2}[A-Z0-9]{13}$/;

function nextProjectCode(tx: DbOrTx, now: Date): string {
  const year = now.getUTCFullYear();
  const last = tx
    .select({ code: projects.code })
    .from(projects)
    .where(like(projects.code, `P-${year}-%`))
    .orderBy(desc(projects.code))
    .get();
  const n = last ? Number(last.code.split("-")[2]) + 1 : 1;
  return `P-${year}-${String(n).padStart(3, "0")}`;
}

export function createProject(ctx: Ctx, input: CreateProjectInput): { projectId: number } {
  const actor = requireActor(ctx);
  const name = nonEmpty(input.name, "Project name");
  if (!PROJECT_TYPES.includes(input.projectType) || !KIND_TYPES[input.kind]?.includes(input.projectType)) {
    throw new DomainError("invalid", `A ${input.kind} project cannot be of type ${input.projectType}`);
  }
  return ctx.db.transaction((tx) => {
    const st = tx.select().from(studio).where(eq(studio.id, 1)).get();
    if (!st) throw new DomainError("conflict", "Set up the studio first");
    const { libraryVersionId, configVersionId } = activeVersionIds(tx);
    const config = configById(tx, configVersionId);
    const allMembers = tx.select().from(members).where(eq(members.active, true)).all();
    const memberIds = input.memberIds ?? allMembers.map((m) => m.id);
    if (memberIds.length < 2) throw new DomainError("invalid", "A project needs at least two members so work can be verified");
    for (const id of memberIds) if (!allMembers.some((m) => m.id === id)) throw new DomainError("invalid", "Unknown or inactive member");
    if (input.originatedBy != null && !memberIds.includes(input.originatedBy)) throw new DomainError("invalid", "The originating partner must be on the project");

    let clientId = input.clientId ?? null;
    let clientState = "";
    if (input.kind === "client") {
      if (clientId == null && input.newClient) {
        const g = input.newClient.gstin?.trim().toUpperCase() ?? "";
        if (g && !GSTIN.test(g)) throw new DomainError("invalid", "Client GSTIN must be 15 characters starting with the state code");
        if (g && input.newClient.stateCode && g.slice(0, 2) !== input.newClient.stateCode) throw new DomainError("invalid", "The client GSTIN's first two digits must match the client's state");
        clientId = tx
          .insert(clients)
          .values({
            businessName: nonEmpty(input.newClient.businessName, "Client name"),
            stateCode: input.newClient.stateCode.trim(),
            gstin: input.newClient.gstin?.trim().toUpperCase() ?? "",
            contactName: input.newClient.contactName?.trim() ?? "",
            contactEmail: input.newClient.contactEmail?.trim() ?? "",
            contactPhone: input.newClient.contactPhone?.trim() ?? "",
            createdBy: actor,
            createdAt: iso(ctx.now),
          })
          .returning({ id: clients.id })
          .get().id;
      }
      if (clientId == null) throw new DomainError("invalid", "Choose or add a client");
      const c = tx.select().from(clients).where(eq(clients.id, clientId)).get();
      if (!c) throw new DomainError("invalid", "Client not found");
      clientState = c.stateCode;
    }
    const quoted = input.quotedAmountExGst ?? 0;
    if (!Number.isSafeInteger(quoted) || quoted < 0) throw new DomainError("invalid", "Quoted amount must be a positive amount");
    const schedule: PaymentScheduleEntry[] =
      input.kind === "client"
        ? [
            { milestoneCode: "M2", pct: 50, note: "Advance with the signed contract (Gate 1)" },
            { milestoneCode: "M9", pct: 50, note: "Final payment before handover (Gate 4)" },
          ]
        : [];
    const now = iso(ctx.now);
    const project = tx
      .insert(projects)
      .values({
        code: nextProjectCode(tx, ctx.now),
        name,
        kind: input.kind,
        projectType: input.projectType,
        multilingual: input.multilingual ?? false,
        clientId,
        originatedBy: input.originatedBy ?? null,
        libraryVersionId,
        configVersionId,
        planStatus: "draft",
        closeStatus: "open",
        startDate: input.startDate ?? null,
        targetLaunchDate: input.targetLaunchDate ?? null,
        quotedAmountExGst: quoted,
        gstRegistered: st.gstRegistered,
        gstRateBp: Math.round(config.gst_defaults.rate * 10000),
        sacCode: config.gst_defaults.sac,
        placeOfSupplyState: (input.placeOfSupplyState ?? clientState ?? st.stateCode) || st.stateCode,
        msmeApplicable: input.msmeApplicable ?? st.msmeRegistered,
        deemedAcceptanceClause: input.deemedAcceptanceClause ?? false,
        deemedAcceptanceDays: input.deemedAcceptanceDays ?? null,
        paymentSchedule: schedule,
        notes: input.notes ?? "",
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.insert(projectMembers)
      .values(memberIds.map((m) => ({ projectId: project.id, memberId: m, active: true })))
      .run();

    const templates = tx.select().from(taskTemplates).where(eq(taskTemplates.libraryVersionId, libraryVersionId)).all();
    const picked = selectTemplatesForType(templates, input.projectType, { multilingual: input.multilingual ?? false }).sort((x, y) => x.sortOrder - y.sortOrder);
    insertTasksFromTemplates(tx, ctx, project, config, picked, "plan");

    if (input.kind === "client") {
      tx.insert(handoverItems)
        .values(config.handover_items.map((h) => ({ projectId: project.id, code: h.code, status: "pending", updatedAt: now, updatedBy: actor })))
        .run();
    }
    audit(tx, ctx, "project.create", "project", project.id, project.id, undefined, {
      code: project.code,
      name,
      kind: input.kind,
      type: input.projectType,
      tasks: picked.length,
      members: memberIds,
      originatedBy: input.originatedBy ?? null,
    });
    return { projectId: project.id };
  });
}

/** Status for tasks added now: free edits in a draft plan; proposals (72h silence = approval) once locked. */
function newTaskStatus(project: ProjectRow): "planned" | "proposed" {
  return project.planStatus === "locked" ? "proposed" : "planned";
}

function uniqueCode(tx: DbOrTx, projectId: number, code: string): string {
  const existing = new Set(
    tx
      .select({ code: taskInstances.code })
      .from(taskInstances)
      .where(and(eq(taskInstances.projectId, projectId), like(taskInstances.code, `${code}%`)))
      .all()
      .map((r) => r.code),
  );
  if (!existing.has(code)) return code;
  for (let i = 2; ; i++) if (!existing.has(`${code}#${i}`)) return `${code}#${i}`;
}

export function categoryFlags(tx: DbOrTx, libraryVersionId: number) {
  return new Map(
    tx
      .select()
      .from(categoryTemplates)
      .where(eq(categoryTemplates.libraryVersionId, libraryVersionId))
      .all()
      .map((c) => [c.code, c]),
  );
}

function memberRoles(tx: DbOrTx, projectId: number) {
  const ids = projectMemberIds(tx, projectId);
  return tx
    .select({ id: members.id, roles: members.roles })
    .from(members)
    .all()
    .filter((m) => ids.includes(m.id));
}

export function insertTasksFromTemplates(
  tx: DbOrTx,
  ctx: Ctx,
  project: ProjectRow,
  config: StudioConfig,
  templates: TemplateRow[],
  origin: "plan" | "proposed",
): number[] {
  const cats = categoryFlags(tx, project.libraryVersionId);
  const assignments = suggestAssignments(
    templates.map((t) => ({ code: t.code, defaultOwnerRole: t.defaultOwnerRole, points: t.defaultPoints })),
    memberRoles(tx, project.id),
  );
  const status = newTaskStatus(project);
  const now = iso(ctx.now);
  const ids: number[] = [];
  templates.forEach((t, i) => {
    const cat = cats.get(t.categoryCode);
    const a = assignments.get(t.code);
    const id = tx
      .insert(taskInstances)
      .values({
        projectId: project.id,
        templateId: t.id,
        code: uniqueCode(tx, project.id, t.code),
        categoryCode: t.categoryCode,
        name: t.name,
        description: t.description,
        phase: t.phase,
        dependsOn: t.dependsOn,
        classification: t.classification,
        complexity: t.complexity,
        clientApproval: t.clientApproval,
        deliverable: t.deliverable,
        evidenceExpected: t.evidenceExpected,
        defaultPoints: t.defaultPoints,
        unit: t.unit,
        effortMidHours: t.effortMidHours,
        isCommunication: cat?.isCommunication ?? false,
        isSales: cat?.isSales ?? false,
        isBusinessLevel: t.isBusinessLevel,
        status,
        origin: status === "proposed" ? "proposed" : origin,
        proposedBy: status === "proposed" ? ctx.actorId : null,
        proposedAt: status === "proposed" ? now : null,
        autoApproveAt: status === "proposed" ? iso(addHours(ctx.now, config.calculation.auto_approve_hours)) : null,
        ownerMemberId: a?.ownerMemberId ?? ctx.actorId,
        sortOrder: t.sortOrder,
        createdBy: ctx.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: taskInstances.id })
      .get().id;
    const shares = a?.sharesBp ?? (ctx.actorId ? { [ctx.actorId]: 10000 } : {});
    const rows = Object.entries(shares).map(([m, bp]) => ({ taskInstanceId: id, memberId: Number(m), shareBp: bp }));
    if (rows.length) tx.insert(taskContributions).values(rows).run();
    if (t.clientApproval !== "No") {
      tx.insert(clientApprovals)
        .values({ taskInstanceId: id, status: t.clientApproval === "Yes" ? "pending" : "not_required", updatedAt: now, updatedBy: ctx.actorId })
        .run();
    }
    ids.push(id);
  });
  return ids;
}

export function updateProjectDetails(
  ctx: Ctx,
  projectId: number,
  patch: Partial<Pick<CreateProjectInput, "name" | "startDate" | "targetLaunchDate" | "placeOfSupplyState" | "msmeApplicable" | "deemedAcceptanceClause" | "deemedAcceptanceDays" | "notes" | "originatedBy" | "quotedAmountExGst">> & {
    paymentSchedule?: PaymentScheduleEntry[];
  },
) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, projectId, actor);
    if (patch.originatedBy !== undefined && patch.originatedBy !== p.originatedBy && p.planStatus !== "draft") {
      throw new DomainError("locked", "Origination credit is part of the locked plan and cannot change now");
    }
    if (patch.originatedBy != null && !projectMemberIds(tx, projectId).includes(patch.originatedBy)) {
      throw new DomainError("invalid", "The originating partner must be on the project");
    }
    if (patch.paymentSchedule) {
      const total = patch.paymentSchedule.reduce((s, e) => s + e.pct, 0);
      if (patch.paymentSchedule.length && Math.abs(total - 100) > 1e-9) throw new DomainError("invalid", "Payment schedule must add up to 100%");
    }
    const next = {
      name: patch.name !== undefined ? nonEmpty(patch.name, "Project name") : p.name,
      startDate: patch.startDate !== undefined ? patch.startDate : p.startDate,
      targetLaunchDate: patch.targetLaunchDate !== undefined ? patch.targetLaunchDate : p.targetLaunchDate,
      placeOfSupplyState: patch.placeOfSupplyState ?? p.placeOfSupplyState,
      msmeApplicable: patch.msmeApplicable ?? p.msmeApplicable,
      deemedAcceptanceClause: patch.deemedAcceptanceClause ?? p.deemedAcceptanceClause,
      deemedAcceptanceDays: patch.deemedAcceptanceDays !== undefined ? patch.deemedAcceptanceDays : p.deemedAcceptanceDays,
      notes: patch.notes ?? p.notes,
      originatedBy: patch.originatedBy !== undefined ? patch.originatedBy : p.originatedBy,
      quotedAmountExGst: patch.quotedAmountExGst ?? p.quotedAmountExGst,
      paymentSchedule: patch.paymentSchedule ?? p.paymentSchedule,
      updatedAt: iso(ctx.now),
    };
    tx.update(projects).set(next).where(eq(projects.id, projectId)).run();
    audit(tx, ctx, "project.update", "project", projectId, projectId, p, next);
  });
}

export function getProject(db: DbOrTx, projectId: number) {
  return loadProject(db, projectId);
}


/** Client contact and tax details (used on invoices, quotes and the WhatsApp/email buttons). */
export function updateClient(
  ctx: Ctx,
  clientId: number,
  patch: { businessName: string; stateCode: string; gstin: string; contactName: string; contactEmail: string; contactPhone: string; address: string },
) {
  requireActor(ctx);
  const gstin = patch.gstin.trim().toUpperCase();
  if (gstin && !GSTIN.test(gstin)) throw new DomainError("invalid", "GSTIN must be 15 characters starting with the state code");
  if (gstin && patch.stateCode && gstin.slice(0, 2) !== patch.stateCode) throw new DomainError("invalid", "The GSTIN's first two digits must match the client's state");
  const email = patch.contactEmail.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError("invalid", "Enter a valid email address");
  ctx.db.transaction((tx) => {
    const before = tx.select().from(clients).where(eq(clients.id, clientId)).get();
    if (!before) throw new DomainError("not_found", "Client not found");
    const next = {
      businessName: nonEmpty(patch.businessName, "Client name"),
      stateCode: patch.stateCode.trim(),
      gstin,
      contactName: patch.contactName.trim(),
      contactEmail: email,
      contactPhone: patch.contactPhone.trim(),
      address: patch.address.trim(),
    };
    tx.update(clients).set(next).where(eq(clients.id, clientId)).run();
    audit(tx, ctx, "client.update", "client", clientId, null, before, next);
  });
}
