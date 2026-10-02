import { and, eq, inArray, like } from "drizzle-orm";
import { adjustmentFactorAllowed, sharesValid } from "@/domain/taskRules";
import type { DbOrTx } from "@/db";
import { categoryTemplates, clientApprovals, evidence, projects, taskInstances, taskTemplates, timeEntries } from "@/db/schema";
import { allApproved, castVote } from "./approvals";
import type { Ctx } from "./context";
import { addHours, iso } from "./context";
import {
  assertProjectMember,
  assertProjectOpen,
  audit,
  contributionsOf,
  loadProject,
  loadTask,
  nonEmpty,
  projectConfig,
  projectMemberIds,
  replaceContributions,
  requireActor,
  type ProjectRow,
} from "./common";
import { DomainError } from "./errors";
import { insertTasksFromTemplates } from "./projects";

const EDITABLE_STATUSES = ["planned", "proposed", "in_progress", "blocked"];

function assertDraftPlan(p: ProjectRow) {
  assertProjectOpen(p);
  if (p.planStatus === "locked") throw new DomainError("locked", "The plan is locked — request an adjustment instead");
  if (p.planStatus === "awaiting_partner") throw new DomainError("conflict", "The plan is waiting for approval. Withdraw or reject it before editing.");
}

function validateShares(tx: DbOrTx, projectId: number, sharesBp: Record<number, number>) {
  if (!sharesValid(sharesBp)) throw new DomainError("invalid", "Shares must be whole basis points that add up to exactly 100%");
  const ids = projectMemberIds(tx, projectId);
  for (const m of Object.keys(sharesBp)) if (!ids.includes(Number(m))) throw new DomainError("invalid", "Shares can only go to project members");
}

export interface PlannedTaskPatch {
  ownerMemberId?: number;
  sharesBp?: Record<number, number>;
  quantity?: number;
  adjustmentFactor?: number;
  ownDefect?: boolean;
  defectOfTaskId?: number | null;
  notes?: string;
}

/** Free edits while the plan is a draft — but never on work already submitted (decision D10). */
export function updatePlannedTask(ctx: Ctx, taskId: number, patch: PlannedTaskPatch) {
  requireActor(ctx);
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertDraftPlan(p);
    if (!EDITABLE_STATUSES.includes(t.status)) {
      throw new DomainError("locked", "This task has already been submitted, so its owner, shares, quantity and factor are frozen. Raise a dispute or adjustment instead.");
    }
    const cfg = projectConfig(tx, p).calculation;
    if (patch.quantity !== undefined && !(patch.quantity > 0 && patch.quantity <= 1000)) throw new DomainError("invalid", "Quantity must be more than 0");
    if (patch.adjustmentFactor !== undefined && !adjustmentFactorAllowed(patch.adjustmentFactor, cfg)) {
      throw new DomainError("invalid", `Adjustment factor must be between ${cfg.adjustment_min} and ${cfg.adjustment_max}`);
    }
    let shares = patch.sharesBp;
    if (patch.ownerMemberId !== undefined) {
      assertProjectMember(tx, p.id, patch.ownerMemberId);
      if (!shares) {
        const current = contributionsOf(tx, taskId);
        shares = current.length === 1 ? { [patch.ownerMemberId]: 10000 } : undefined;
      }
    }
    if (shares) validateShares(tx, p.id, shares);
    if (patch.defectOfTaskId != null) {
      const d = loadTask(tx, patch.defectOfTaskId);
      if (d.projectId !== p.id) throw new DomainError("invalid", "The defective task must be in the same project");
    }
    const before = { ...t, shares: contributionsOf(tx, taskId) };
    const next = {
      ownerMemberId: patch.ownerMemberId ?? t.ownerMemberId,
      quantity: patch.quantity ?? t.quantity,
      adjustmentFactor: patch.adjustmentFactor ?? t.adjustmentFactor,
      ownDefect: patch.ownDefect ?? t.ownDefect,
      defectOfTaskId: patch.defectOfTaskId !== undefined ? patch.defectOfTaskId : t.defectOfTaskId,
      notes: patch.notes ?? t.notes,
      updatedAt: iso(ctx.now),
    };
    tx.update(taskInstances).set(next).where(eq(taskInstances.id, taskId)).run();
    if (shares) replaceContributions(tx, taskId, shares);
    audit(tx, ctx, "plan.update_task", "task", taskId, p.id, before, { ...next, shares: shares ?? before.shares });
  });
}

export function removePlannedTask(ctx: Ctx, taskId: number) {
  requireActor(ctx);
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertDraftPlan(p);
    if (t.status !== "planned") throw new DomainError("conflict", "Only tasks that have not started can be removed from the plan");
    if (tx.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.subjectType, "task"), eq(evidence.subjectId, taskId))).get()) {
      throw new DomainError("conflict", "This task already has evidence. Cancel it instead of removing it.");
    }
    if (tx.select({ id: timeEntries.id }).from(timeEntries).where(eq(timeEntries.taskInstanceId, taskId)).get()) {
      throw new DomainError("conflict", "This task already has time logged. Cancel it instead of removing it.");
    }
    const before = { ...t, shares: contributionsOf(tx, taskId) };
    replaceContributions(tx, taskId, {});
    tx.delete(clientApprovals).where(eq(clientApprovals.taskInstanceId, taskId)).run();
    tx.delete(taskInstances).where(eq(taskInstances.id, taskId)).run();
    audit(tx, ctx, "plan.remove_task", "task", taskId, p.id, before, undefined);
  });
}

export function addTasksFromLibrary(ctx: Ctx, projectId: number, codes: string[]): { taskIds: number[] } {
  requireActor(ctx);
  if (codes.length === 0) throw new DomainError("invalid", "Choose at least one task");
  return ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    if (p.planStatus === "awaiting_partner") throw new DomainError("conflict", "The plan is waiting for approval. Withdraw or reject it first.");
    const templates = tx
      .select()
      .from(taskTemplates)
      .where(and(eq(taskTemplates.libraryVersionId, p.libraryVersionId), inArray(taskTemplates.code, codes)))
      .all();
    if (templates.length !== new Set(codes).size) throw new DomainError("invalid", "Some tasks were not found in this project's library version");
    const ids = insertTasksFromTemplates(tx, ctx, p, projectConfig(tx, p), templates, "plan");
    audit(tx, ctx, p.planStatus === "locked" ? "plan.propose_tasks" : "plan.add_tasks", "project", p.id, p.id, undefined, { codes, taskIds: ids });
    return { taskIds: ids };
  });
}

export interface CustomTaskInput {
  name: string;
  categoryCode: string;
  defaultPoints: number;
  description?: string;
  ownerMemberId?: number;
  sharesBp?: Record<number, number>;
  quantity?: number;
}

/** Adds a task that is not in the library. After plan lock it is a proposal the other partner approves (or silence for 72h). */
export function insertCustomTask(
  tx: DbOrTx,
  ctx: Ctx,
  p: ProjectRow,
  input: CustomTaskInput & { origin?: "plan" | "proposed" | "action_item" | "change_request"; communicationId?: number; changeRequestId?: number },
): { taskId: number; code: string } {
  const actor = requireActor(ctx);
  const name = nonEmpty(input.name, "Task name");
  const cat = tx
    .select()
    .from(categoryTemplates)
    .where(and(eq(categoryTemplates.libraryVersionId, p.libraryVersionId), eq(categoryTemplates.code, input.categoryCode)))
    .get();
  if (!cat) throw new DomainError("invalid", "Unknown category");
  if (!(input.defaultPoints > 0 && input.defaultPoints <= 200)) throw new DomainError("invalid", "Points must be between 1 and 200");
  const owner = input.ownerMemberId ?? actor;
  assertProjectMember(tx, p.id, owner);
  const shares = input.sharesBp ?? { [owner]: 10000 };
  validateShares(tx, p.id, shares);
  const prefix = `${input.categoryCode}-X`;
  const taken = tx
    .select({ code: taskInstances.code })
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, p.id), like(taskInstances.code, `${prefix}%`)))
    .all().length;
  const code = `${prefix}${String(taken + 1).padStart(2, "0")}`;
  const locked = p.planStatus === "locked";
  const cfg = projectConfig(tx, p).calculation;
  const now = iso(ctx.now);
  const id = tx
    .insert(taskInstances)
    .values({
      projectId: p.id,
      code,
      categoryCode: cat.code,
      name,
      description: input.description?.trim() ?? "",
      phase: cat.phase,
      dependsOn: [],
      defaultPoints: input.defaultPoints,
      quantity: input.quantity ?? 1,
      isCommunication: cat.isCommunication,
      isSales: cat.isSales,
      isBusinessLevel: cat.isBusinessLevel,
      status: locked ? "proposed" : "planned",
      origin: input.origin && input.origin !== "plan" ? input.origin : locked ? "proposed" : "plan",
      proposedBy: locked ? actor : null,
      proposedAt: locked ? now : null,
      autoApproveAt: locked ? iso(addHours(ctx.now, cfg.auto_approve_hours)) : null,
      ownerMemberId: owner,
      communicationId: input.communicationId ?? null,
      changeRequestId: input.changeRequestId ?? null,
      sortOrder: 100000,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: taskInstances.id })
    .get().id;
  replaceContributions(tx, id, shares);
  audit(tx, ctx, locked ? "task.propose" : "plan.add_custom_task", "task", id, p.id, undefined, { code, name, points: input.defaultPoints, shares, status: locked ? "proposed" : "planned" });
  return { taskId: id, code };
}

export function proposeCustomTask(ctx: Ctx, projectId: number, input: CustomTaskInput): { taskId: number; code: string } {
  return ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    if (p.planStatus === "awaiting_partner") throw new DomainError("conflict", "The plan is waiting for approval. Withdraw or reject it first.");
    return insertCustomTask(tx, ctx, p, input);
  });
}

export function approveProposal(ctx: Ctx, taskId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (t.status !== "proposed") throw new DomainError("conflict", "This task is not waiting for approval");
    if (t.proposedBy === actor) throw new DomainError("forbidden", "Only the other partner can approve your proposal");
    tx.update(taskInstances).set({ status: "planned", autoApproveAt: null, updatedAt: iso(ctx.now) }).where(eq(taskInstances.id, taskId)).run();
    audit(tx, ctx, "task.approve_proposal", "task", taskId, p.id, { status: "proposed" }, { status: "planned" });
  });
}

export function rejectProposal(ctx: Ctx, taskId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (t.status !== "proposed") throw new DomainError("conflict", "This task is not waiting for approval");
    tx.update(taskInstances)
      .set({ status: "cancelled", cancelReason: t.proposedBy === actor ? `Withdrawn: ${why}` : why, cancelledAt: iso(ctx.now), autoApproveAt: null, updatedAt: iso(ctx.now) })
      .where(eq(taskInstances.id, taskId))
      .run();
    audit(tx, ctx, t.proposedBy === actor ? "task.withdraw_proposal" : "task.reject_proposal", "task", taskId, p.id, { status: "proposed" }, { status: "cancelled", reason: why });
  });
}

function validatePlanForLock(tx: DbOrTx, p: ProjectRow) {
  const tasks = tx.select().from(taskInstances).where(eq(taskInstances.projectId, p.id)).all();
  const members = projectMemberIds(tx, p.id);
  for (const t of tasks) {
    if (t.status === "cancelled") continue;
    const c = contributionsOf(tx, t.id);
    const shares = Object.fromEntries(c.map((x) => [x.memberId, x.shareBp]));
    if (!sharesValid(shares) || c.some((x) => !members.includes(x.memberId))) {
      throw new DomainError("invalid", `Task ${t.code} needs owners whose shares add up to 100%`);
    }
  }
}

export function submitPlan(ctx: Ctx, projectId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertDraftPlan(p);
    assertProjectMember(tx, p.id, actor);
    validatePlanForLock(tx, p);
    tx.update(projects).set({ planStatus: "awaiting_partner", planSubmittedBy: actor, updatedAt: iso(ctx.now) }).where(eq(projects.id, p.id)).run();
    castVote(tx, { subjectType: "plan", subjectId: p.id, round: p.planRound, memberId: actor, decision: "approve", now: ctx.now, label: "plan" });
    audit(tx, ctx, "plan.submit", "project", p.id, p.id, { planStatus: p.planStatus }, { planStatus: "awaiting_partner", round: p.planRound });
    maybeLockPlan(tx, ctx, p.id);
  });
}

function maybeLockPlan(tx: DbOrTx, ctx: Ctx, projectId: number) {
  const p = loadProject(tx, projectId);
  if (allApproved(tx, "plan", p.id, p.planRound, projectMemberIds(tx, p.id))) {
    tx.update(projects).set({ planStatus: "locked", planLockedAt: iso(ctx.now), updatedAt: iso(ctx.now) }).where(eq(projects.id, p.id)).run();
    audit(tx, ctx, "plan.lock", "project", p.id, p.id, { planStatus: "awaiting_partner" }, { planStatus: "locked", round: p.planRound });
  }
}

export function approvePlan(ctx: Ctx, projectId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (p.planStatus !== "awaiting_partner") throw new DomainError("conflict", "The plan is not waiting for approval");
    castVote(tx, { subjectType: "plan", subjectId: p.id, round: p.planRound, memberId: actor, decision: "approve", now: ctx.now, label: "plan" });
    audit(tx, ctx, "plan.approve", "project", p.id, p.id, undefined, { round: p.planRound });
    maybeLockPlan(tx, ctx, p.id);
  });
}

export function rejectPlan(ctx: Ctx, projectId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (p.planStatus !== "awaiting_partner") throw new DomainError("conflict", "The plan is not waiting for approval");
    if (actor !== p.planSubmittedBy) {
      castVote(tx, { subjectType: "plan", subjectId: p.id, round: p.planRound, memberId: actor, decision: "reject", note: why, now: ctx.now, label: "plan" });
    }
    tx.update(projects).set({ planStatus: "draft", planRound: p.planRound + 1, planSubmittedBy: null, updatedAt: iso(ctx.now) }).where(eq(projects.id, p.id)).run();
    audit(tx, ctx, actor === p.planSubmittedBy ? "plan.withdraw" : "plan.reject", "project", p.id, p.id, { planStatus: "awaiting_partner" }, { planStatus: "draft", reason: why });
  });
}

export const withdrawPlan = (ctx: Ctx, projectId: number) => rejectPlan(ctx, projectId, "Withdrawn for more edits");
