import { and, eq } from "drizzle-orm";
import { parseStudioConfig, type StudioConfig } from "@/domain/config";
import type { DbOrTx } from "@/db";
import { configVersions, projectMembers, projects, taskContributions, taskInstances } from "@/db/schema";
import { appendAudit } from "./audit";
import type { Ctx } from "./context";
import { iso } from "./context";
import { DomainError } from "./errors";

export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof taskInstances.$inferSelect;

export function requireActor(ctx: Ctx): number {
  if (ctx.actorId === null) throw new DomainError("unauthenticated", "Please sign in again");
  return ctx.actorId;
}

export function loadProject(tx: DbOrTx, projectId: number): ProjectRow {
  const p = tx.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!p) throw new DomainError("not_found", "Project not found");
  return p;
}

export function assertProjectOpen(p: ProjectRow) {
  if (p.closeStatus === "closed_locked") {
    throw new DomainError("locked", "This project is closed and locked. Record a post-lock adjustment instead of editing it.");
  }
}

export function projectMemberIds(tx: DbOrTx, projectId: number): number[] {
  return tx
    .select({ m: projectMembers.memberId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.active, true)))
    .all()
    .map((r) => r.m)
    .sort((x, y) => x - y);
}

export function assertProjectMember(tx: DbOrTx, projectId: number, memberId: number) {
  if (!projectMemberIds(tx, projectId).includes(memberId)) throw new DomainError("forbidden", "You are not a member of this project");
}

const configCache = new Map<number, StudioConfig>();

export function configById(tx: DbOrTx, configVersionId: number): StudioConfig {
  const cached = configCache.get(configVersionId);
  if (cached) return cached;
  const row = tx.select().from(configVersions).where(eq(configVersions.id, configVersionId)).get();
  if (!row) throw new DomainError("not_found", "Configuration version not found");
  const cfg = parseStudioConfig(row.data);
  // Only active/superseded versions are immutable; drafts can change, so do not cache them.
  if (row.status === "active" || row.status === "superseded") configCache.set(configVersionId, cfg);
  return cfg;
}

export function projectConfig(tx: DbOrTx, p: ProjectRow): StudioConfig {
  return configById(tx, p.configVersionId);
}

export function loadTask(tx: DbOrTx, taskId: number): TaskRow {
  const t = tx.select().from(taskInstances).where(eq(taskInstances.id, taskId)).get();
  if (!t) throw new DomainError("not_found", "Task not found");
  return t;
}

export function contributionsOf(tx: DbOrTx, taskId: number): { memberId: number; shareBp: number }[] {
  return tx
    .select({ memberId: taskContributions.memberId, shareBp: taskContributions.shareBp })
    .from(taskContributions)
    .where(eq(taskContributions.taskInstanceId, taskId))
    .all()
    .sort((x, y) => x.memberId - y.memberId);
}

export function replaceContributions(tx: DbOrTx, taskId: number, sharesBp: Record<number, number>) {
  tx.delete(taskContributions).where(eq(taskContributions.taskInstanceId, taskId)).run();
  const rows = Object.entries(sharesBp)
    .filter(([, bp]) => bp > 0)
    .map(([m, bp]) => ({ taskInstanceId: taskId, memberId: Number(m), shareBp: bp }));
  if (rows.length) tx.insert(taskContributions).values(rows).run();
}

export function audit(
  tx: DbOrTx,
  ctx: Ctx,
  action: string,
  entityType: string,
  entityId: string | number,
  projectId: number | null,
  before?: unknown,
  after?: unknown,
) {
  appendAudit(tx, { at: iso(ctx.now), actorMemberId: ctx.actorId, action, entityType, entityId, projectId, before, after });
}

export function nonEmpty(value: string | undefined | null, label: string): string {
  const v = (value ?? "").trim();
  if (!v) throw new DomainError("invalid", `${label} is required`);
  return v;
}

export function isoDateValid(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
}

export function assertDate(d: string, label: string) {
  if (!isoDateValid(d)) throw new DomainError("invalid", `${label} must be a date (YYYY-MM-DD)`);
}
