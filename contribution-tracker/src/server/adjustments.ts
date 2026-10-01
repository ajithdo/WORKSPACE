import { and, eq } from "drizzle-orm";
import { adjustmentFactorAllowed, assertTransition, effortTriggerMet, sharesValid } from "@/domain/taskRules";
import type { TaskStatus } from "@/domain/types";
import type { DbOrTx } from "@/db";
import { adjustmentRequests, taskInstances } from "@/db/schema";
import type { Ctx } from "./context";
import { iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, loadProject, loadTask, nonEmpty, projectConfig, projectMemberIds, replaceContributions, requireActor } from "./common";
import { insertDispute } from "./disputes";
import { DomainError } from "./errors";
import { hoursLogged } from "./tasks";

export type AdjustmentKind = "factor" | "quantity" | "shares" | "descope";

export function requestAdjustment(
  ctx: Ctx,
  input: { taskInstanceId: number; kind: AdjustmentKind; payload: Record<string, unknown>; reason: string },
): { adjustmentId: number } {
  const actor = requireActor(ctx);
  const reason = nonEmpty(input.reason, "A reason");
  return ctx.db.transaction((tx) => {
    const t = loadTask(tx, input.taskInstanceId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (p.planStatus !== "locked") throw new DomainError("conflict", "The plan is still a draft — edit the task directly");
    if (t.status === "locked" || t.status === "cancelled" || t.status === "proposed") throw new DomainError("conflict", "This task cannot be adjusted");
    const cfg = projectConfig(tx, p);
    if (input.kind === "factor") {
      const f = Number(input.payload.factor);
      if (!adjustmentFactorAllowed(f, cfg.calculation)) throw new DomainError("invalid", `Factor must be between ${cfg.calculation.adjustment_min} and ${cfg.calculation.adjustment_max}`);
      if (f > 1 && f > t.adjustmentFactor) {
        const estimate = t.effortMidHours !== null ? t.effortMidHours * t.quantity : null;
        const logged = hoursLogged(tx, t.id);
        const multiple = cfg.calculation.effort_adjustment_trigger_multiple;
        if (!effortTriggerMet(logged, estimate, multiple)) {
          throw new DomainError(
            "conflict",
            `Raising the factor needs logged hours above ${multiple}× the estimate (logged ${logged.toFixed(1)} h, estimate ${estimate?.toFixed(1)} h). Log your time first.`,
          );
        }
      }
    }
    if (input.kind === "quantity" && !(Number(input.payload.quantity) > 0)) throw new DomainError("invalid", "Quantity must be more than 0");
    if (input.kind === "shares") {
      const shares = input.payload.sharesBp as Record<number, number>;
      if (!sharesValid(shares)) throw new DomainError("invalid", "Shares must add up to exactly 100%");
      const ids = projectMemberIds(tx, p.id);
      if (Object.keys(shares).some((m) => !ids.includes(Number(m)))) throw new DomainError("invalid", "Shares can only go to project members");
    }
    if (input.kind === "descope") assertTransition(t.status as TaskStatus, "cancelled", cfg.task_transitions);
    const open = tx
      .select({ id: adjustmentRequests.id })
      .from(adjustmentRequests)
      .where(and(eq(adjustmentRequests.taskInstanceId, t.id), eq(adjustmentRequests.status, "requested")))
      .get();
    if (open) throw new DomainError("conflict", "This task already has an adjustment waiting for approval");
    const id = tx
      .insert(adjustmentRequests)
      .values({ projectId: p.id, taskInstanceId: t.id, kind: input.kind, payload: input.payload, reason, requestedBy: actor, requestedAt: iso(ctx.now), status: "requested" })
      .returning({ id: adjustmentRequests.id })
      .get().id;
    audit(tx, ctx, "adjustment.request", "adjustment", id, p.id, undefined, { taskId: t.id, code: t.code, ...input });
    return { adjustmentId: id };
  });
}

function loadAdjustment(tx: DbOrTx, id: number) {
  const a = tx.select().from(adjustmentRequests).where(eq(adjustmentRequests.id, id)).get();
  if (!a) throw new DomainError("not_found", "Adjustment not found");
  return a;
}

export function approveAdjustment(ctx: Ctx, adjustmentId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const a = loadAdjustment(tx, adjustmentId);
    const p = loadProject(tx, a.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (a.status !== "requested") throw new DomainError("conflict", "This adjustment was already decided");
    if (a.requestedBy === actor) throw new DomainError("forbidden", "Only the other partner can approve your adjustment");
    if (!a.taskInstanceId) throw new DomainError("invalid", "Adjustment has no task");
    const t = loadTask(tx, a.taskInstanceId);
    const now = iso(ctx.now);
    if (a.kind === "factor") tx.update(taskInstances).set({ adjustmentFactor: Number(a.payload.factor), updatedAt: now }).where(eq(taskInstances.id, t.id)).run();
    if (a.kind === "quantity") tx.update(taskInstances).set({ quantity: Number(a.payload.quantity), updatedAt: now }).where(eq(taskInstances.id, t.id)).run();
    if (a.kind === "shares") replaceContributions(tx, t.id, a.payload.sharesBp as Record<number, number>);
    if (a.kind === "descope") {
      assertTransition(t.status as TaskStatus, "cancelled", projectConfig(tx, p).task_transitions);
      tx.update(taskInstances).set({ status: "cancelled", cancelReason: a.reason, cancelledAt: now, updatedAt: now }).where(eq(taskInstances.id, t.id)).run();
    }
    tx.update(adjustmentRequests).set({ status: "approved", decidedBy: actor, decidedAt: now }).where(eq(adjustmentRequests.id, a.id)).run();
    audit(tx, ctx, "adjustment.approve", "adjustment", a.id, p.id, { task: t }, { kind: a.kind, payload: a.payload });
  });
}

export function disputeAdjustment(ctx: Ctx, adjustmentId: number, reason: string): { disputeId: number } {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  return ctx.db.transaction((tx) => {
    const a = loadAdjustment(tx, adjustmentId);
    const p = loadProject(tx, a.projectId);
    assertProjectOpen(p);
    if (a.status !== "requested") throw new DomainError("conflict", "This adjustment was already decided");
    if (a.requestedBy === actor) throw new DomainError("forbidden", "You cannot dispute your own adjustment; withdraw it instead");
    const disputeId = insertDispute(tx, ctx, { projectId: p.id, targetType: "adjustment", targetId: a.id, reasonCode: "points_inflated", description: why }, { skipWindow: true });
    tx.update(adjustmentRequests).set({ status: "disputed", decidedBy: actor, decidedAt: iso(ctx.now), decisionNote: why, disputeId }).where(eq(adjustmentRequests.id, a.id)).run();
    audit(tx, ctx, "adjustment.dispute", "adjustment", a.id, p.id, { status: "requested" }, { status: "disputed", disputeId });
    return { disputeId };
  });
}

export function withdrawAdjustment(ctx: Ctx, adjustmentId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const a = loadAdjustment(tx, adjustmentId);
    const p = loadProject(tx, a.projectId);
    assertProjectOpen(p);
    if (a.requestedBy !== actor) throw new DomainError("forbidden", "Only the person who asked can withdraw it");
    if (a.status !== "requested") throw new DomainError("conflict", "This adjustment was already decided");
    tx.update(adjustmentRequests).set({ status: "withdrawn", decidedAt: iso(ctx.now) }).where(eq(adjustmentRequests.id, a.id)).run();
    audit(tx, ctx, "adjustment.withdraw", "adjustment", a.id, p.id, { status: "requested" }, { status: "withdrawn" });
  });
}
