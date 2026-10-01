import { and, eq, inArray } from "drizzle-orm";
import { equalSharesBp } from "@/domain/assignment";
import { adjustmentFactorAllowed, sharesValid } from "@/domain/taskRules";
import type { DbOrTx } from "@/db";
import { adjustmentRequests, communications, disputeComments, disputes, evidence, expenses, retroItems, taskInstances } from "@/db/schema";
import type { Ctx } from "./context";
import { addDays, iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, contributionsOf, loadProject, nonEmpty, projectConfig, replaceContributions, requireActor, type ProjectRow } from "./common";
import { ACTIVE_DISPUTE } from "./contribution";
import { DomainError } from "./errors";

export type DisputeRow = typeof disputes.$inferSelect;
export type DisputeTarget = DisputeRow["targetType"];

function loadDispute(tx: DbOrTx, id: number): DisputeRow {
  const d = tx.select().from(disputes).where(eq(disputes.id, id)).get();
  if (!d) throw new DomainError("not_found", "Dispute not found");
  return d;
}

interface TargetInfo {
  /** Members whose points or money the item affects. */
  beneficiaries: number[];
  /** When the dispute window started (verification or approval), if it applies. */
  windowStart: string | null;
  label: string;
}

function targetInfo(tx: DbOrTx, p: ProjectRow, type: DisputeTarget, id: number): TargetInfo {
  switch (type) {
    case "task_instance": {
      const t = tx.select().from(taskInstances).where(eq(taskInstances.id, id)).get();
      if (!t || t.projectId !== p.id) throw new DomainError("not_found", "Task not found in this project");
      if (t.status !== "verified") throw new DomainError("conflict", "Only verified tasks can be disputed (send a submission back instead)");
      return { beneficiaries: contributionsOf(tx, t.id).map((c) => c.memberId), windowStart: t.verifiedAt, label: `${t.code} ${t.name}` };
    }
    case "evidence": {
      const e = tx.select().from(evidence).where(eq(evidence.id, id)).get();
      if (!e || e.projectId !== p.id || e.subjectType !== "task") throw new DomainError("not_found", "Task evidence not found in this project");
      const info = targetInfo(tx, p, "task_instance", e.subjectId);
      return { ...info, label: `evidence #${e.id} on ${info.label}` };
    }
    case "communication": {
      const c = tx.select().from(communications).where(eq(communications.id, id)).get();
      if (!c || c.projectId !== p.id) throw new DomainError("not_found", "Communication not found in this project");
      if (c.status !== "verified") throw new DomainError("conflict", "Only verified communications can be disputed");
      const b = [c.leadMemberId, ...(c.secondRequired && c.secondMemberId !== null ? [c.secondMemberId] : [])];
      return { beneficiaries: b, windowStart: c.verifiedAt, label: `${c.type.replaceAll("_", " ")} on ${c.occurredAt?.slice(0, 10) ?? ""}` };
    }
    case "expense": {
      const e = tx.select().from(expenses).where(eq(expenses.id, id)).get();
      if (!e || e.projectId !== p.id) throw new DomainError("not_found", "Expense not found in this project");
      if (e.status !== "approved") throw new DomainError("conflict", "Only approved expenses can be disputed");
      return { beneficiaries: [e.paidByMemberId ?? e.createdBy], windowStart: e.approvedAt, label: `expense ${e.vendor}` };
    }
    case "adjustment": {
      const a = tx.select().from(adjustmentRequests).where(eq(adjustmentRequests.id, id)).get();
      if (!a || a.projectId !== p.id) throw new DomainError("not_found", "Adjustment not found in this project");
      return { beneficiaries: [a.requestedBy], windowStart: null, label: `adjustment #${a.id}` };
    }
    case "plan":
      if (id !== p.id) throw new DomainError("invalid", "Plan disputes refer to the project");
      return { beneficiaries: [], windowStart: null, label: "project plan" };
  }
}

export function disputeParties(tx: DbOrTx, d: DisputeRow): number[] {
  const p = loadProject(tx, d.projectId);
  let beneficiaries: number[] = [];
  try {
    beneficiaries = targetInfo(tx, p, d.targetType, d.targetId).beneficiaries;
  } catch {
    beneficiaries = [];
  }
  return [...new Set([d.raisedBy, ...beneficiaries])].sort((a, b) => a - b);
}

export interface RaiseDisputeInput {
  projectId: number;
  targetType: DisputeTarget;
  targetId: number;
  reasonCode: string;
  description: string;
}

export function insertDispute(tx: DbOrTx, ctx: Ctx, input: RaiseDisputeInput, opts: { skipWindow?: boolean } = {}): number {
  const actor = requireActor(ctx);
  const p = loadProject(tx, input.projectId);
  if (p.closeStatus === "closed_locked") throw new DomainError("locked", "Disputes must be raised before the project is locked");
  assertProjectMember(tx, p.id, actor);
  const cfg = projectConfig(tx, p);
  if (!cfg.dispute_reason_codes.includes(input.reasonCode)) throw new DomainError("invalid", "Unknown reason");
  const description = nonEmpty(input.description, "Description");
  const info = targetInfo(tx, p, input.targetType, input.targetId);
  const windowDays = cfg.calculation.dispute_window_days;
  if (!opts.skipWindow && info.windowStart && ctx.now > addDays(new Date(info.windowStart), windowDays)) {
    throw new DomainError("conflict", `Disputes must be raised within ${windowDays} days of verification`);
  }
  const active = tx
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(eq(disputes.targetType, input.targetType), eq(disputes.targetId, input.targetId), inArray(disputes.status, [...ACTIVE_DISPUTE])))
    .get();
  if (active) throw new DomainError("conflict", "There is already an open dispute on this item");
  const id = tx
    .insert(disputes)
    .values({
      projectId: p.id,
      targetType: input.targetType,
      targetId: input.targetId,
      raisedBy: actor,
      raisedAt: iso(ctx.now),
      reasonCode: input.reasonCode,
      description,
      status: "open",
      defaultDueAt: iso(addDays(ctx.now, cfg.calculation.dispute_default_resolution_days)),
    })
    .returning({ id: disputes.id })
    .get().id;
  audit(tx, ctx, "dispute.raise", "dispute", id, p.id, undefined, { ...input, target: info.label });
  const count = tx.select({ id: disputes.id }).from(disputes).where(eq(disputes.projectId, p.id)).all().length;
  const threshold = cfg.calculation.dispute_retro_threshold;
  if (count >= threshold && !tx.select({ id: retroItems.id }).from(retroItems).where(and(eq(retroItems.projectId, p.id), eq(retroItems.source, "dispute_threshold"))).get()) {
    tx.insert(retroItems)
      .values({ projectId: p.id, text: `${count} disputes on this project — review how points and evidence are agreed (mandatory retrospective item).`, source: "dispute_threshold", createdAt: iso(ctx.now) })
      .run();
    audit(tx, ctx, "retro.auto_item", "project", p.id, p.id, undefined, { reason: "dispute_threshold", count });
  }
  return id;
}

export function raiseDispute(ctx: Ctx, input: RaiseDisputeInput): { disputeId: number } {
  return ctx.db.transaction((tx) => ({ disputeId: insertDispute(tx, ctx, input) }));
}

function assertParty(tx: DbOrTx, d: DisputeRow, actor: number) {
  assertProjectMember(tx, d.projectId, actor);
}

export function commentOnDispute(ctx: Ctx, disputeId: number, body: string) {
  const actor = requireActor(ctx);
  const text = nonEmpty(body, "Comment");
  ctx.db.transaction((tx) => {
    const d = loadDispute(tx, disputeId);
    assertProjectOpen(loadProject(tx, d.projectId));
    assertParty(tx, d, actor);
    if (d.status === "resolved") throw new DomainError("conflict", "This dispute is resolved");
    tx.insert(disputeComments).values({ disputeId, memberId: actor, body: text, createdAt: iso(ctx.now) }).run();
    if (d.status === "open") tx.update(disputes).set({ status: "in_discussion" }).where(eq(disputes.id, disputeId)).run();
    audit(tx, ctx, "dispute.comment", "dispute", disputeId, d.projectId, undefined, { body: text });
  });
}

const RESOLUTIONS_BY_TARGET: Record<DisputeTarget, string[]> = {
  task_instance: ["accept", "change_shares", "change_adjustment", "reject_zero", "split_50_50"],
  evidence: ["accept", "change_shares", "change_adjustment", "reject_zero", "split_50_50"],
  communication: ["accept", "reject_zero", "split_50_50"],
  expense: ["accept", "reject_zero", "split_50_50"],
  adjustment: ["accept", "change_adjustment", "reject_zero", "split_50_50"],
  plan: ["accept"],
};

function validateResolution(tx: DbOrTx, d: DisputeRow, resolution: string, payload: Record<string, unknown> | null) {
  if (!RESOLUTIONS_BY_TARGET[d.targetType].includes(resolution)) throw new DomainError("invalid", "That resolution does not apply to this kind of item");
  const p = loadProject(tx, d.projectId);
  const cfg = projectConfig(tx, p).calculation;
  if (resolution === "change_shares") {
    const shares = (payload?.sharesBp ?? {}) as Record<number, number>;
    if (!sharesValid(shares)) throw new DomainError("invalid", "New shares must add up to exactly 100%");
  }
  if (resolution === "change_adjustment") {
    const f = Number(payload?.factor);
    if (!adjustmentFactorAllowed(f, cfg)) throw new DomainError("invalid", `Factor must be between ${cfg.adjustment_min} and ${cfg.adjustment_max}`);
  }
}

export function proposeResolution(ctx: Ctx, disputeId: number, input: { resolution: string; payload?: Record<string, unknown> | null; note?: string }) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const d = loadDispute(tx, disputeId);
    assertProjectOpen(loadProject(tx, d.projectId));
    assertParty(tx, d, actor);
    if (d.status === "resolved") throw new DomainError("conflict", "This dispute is resolved");
    validateResolution(tx, d, input.resolution, input.payload ?? null);
    tx.update(disputes)
      .set({ proposedResolution: input.resolution, proposedPayload: input.payload ?? null, proposedBy: actor, proposedAt: iso(ctx.now), status: d.status === "escalated" ? "escalated" : "in_discussion" })
      .where(eq(disputes.id, disputeId))
      .run();
    if (input.note?.trim()) tx.insert(disputeComments).values({ disputeId, memberId: actor, body: input.note.trim(), createdAt: iso(ctx.now) }).run();
    audit(tx, ctx, "dispute.propose", "dispute", disputeId, d.projectId, undefined, input);
  });
}

export function acceptResolution(ctx: Ctx, disputeId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const d = loadDispute(tx, disputeId);
    assertProjectOpen(loadProject(tx, d.projectId));
    assertParty(tx, d, actor);
    if (d.status === "resolved") throw new DomainError("conflict", "This dispute is resolved");
    if (!d.proposedResolution) throw new DomainError("conflict", "There is no proposed resolution yet");
    if (d.proposedBy === actor) throw new DomainError("forbidden", "The other partner must accept your proposal");
    applyResolution(tx, ctx, d, d.proposedResolution, d.proposedPayload ?? null, true, "Agreed by both partners");
  });
}

export function escalateDispute(ctx: Ctx, disputeId: number, note: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(note, "A note");
  ctx.db.transaction((tx) => {
    const d = loadDispute(tx, disputeId);
    assertProjectOpen(loadProject(tx, d.projectId));
    assertParty(tx, d, actor);
    if (d.status === "resolved" || d.status === "escalated") throw new DomainError("conflict", "This dispute cannot be escalated now");
    tx.update(disputes).set({ status: "escalated", escalatedAt: iso(ctx.now), escalatedBy: actor, escalationNote: why }).where(eq(disputes.id, disputeId)).run();
    audit(tx, ctx, "dispute.escalate", "dispute", disputeId, d.projectId, { status: d.status }, { status: "escalated", note: why });
  });
}

/** Applies a resolution's effect to the disputed item, then marks the dispute resolved. */
export function applyResolution(tx: DbOrTx, ctx: Ctx, d: DisputeRow, resolution: string, payload: Record<string, unknown> | null, byBoth: boolean, note: string) {
  const p = loadProject(tx, d.projectId);
  const cfg = projectConfig(tx, p).calculation;
  const parties = disputeParties(tx, d);
  const now = iso(ctx.now);
  const effects: Record<string, unknown> = {};
  const taskId =
    d.targetType === "task_instance" ? d.targetId : d.targetType === "evidence" ? tx.select({ s: evidence.subjectId }).from(evidence).where(eq(evidence.id, d.targetId)).get()?.s : undefined;

  if (taskId !== undefined) {
    const before = contributionsOf(tx, taskId);
    if (resolution === "change_shares") replaceContributions(tx, taskId, payload?.sharesBp as Record<number, number>);
    if (resolution === "change_adjustment") tx.update(taskInstances).set({ adjustmentFactor: Number(payload?.factor), updatedAt: now }).where(eq(taskInstances.id, taskId)).run();
    if (resolution === "reject_zero") {
      tx.update(taskInstances).set({ multiplier: 0, updatedAt: now }).where(eq(taskInstances.id, taskId)).run();
      if (d.targetType === "evidence") tx.update(evidence).set({ verificationStatus: "rejected", rejectionReason: "Dispute resolved: rejected", verifiedAt: now }).where(eq(evidence.id, d.targetId)).run();
    }
    if (resolution === "split_50_50") {
      if (cfg.dispute_default_split_mode === "halve_points") tx.update(taskInstances).set({ multiplier: 0.5, updatedAt: now }).where(eq(taskInstances.id, taskId)).run();
      else replaceContributions(tx, taskId, equalSharesBp([...new Set([...parties, ...before.map((c) => c.memberId)])].sort((a, b) => a - b)));
    }
    effects.sharesBefore = before;
    effects.sharesAfter = contributionsOf(tx, taskId);
  }
  if (d.targetType === "communication") {
    if (resolution === "reject_zero") tx.update(communications).set({ multiplier: 0, updatedAt: now }).where(eq(communications.id, d.targetId)).run();
    if (resolution === "split_50_50") {
      if (cfg.dispute_default_split_mode === "halve_points") tx.update(communications).set({ multiplier: 0.5, updatedAt: now }).where(eq(communications.id, d.targetId)).run();
      else tx.update(communications).set({ splitParties: parties, updatedAt: now }).where(eq(communications.id, d.targetId)).run();
    }
  }
  if (d.targetType === "expense") {
    const e = tx.select().from(expenses).where(eq(expenses.id, d.targetId)).get();
    if (e && resolution === "reject_zero") tx.update(expenses).set({ status: "rejected", rejectionReason: "Dispute resolved: not a business expense" }).where(eq(expenses.id, e.id)).run();
    if (e && resolution === "split_50_50") tx.update(expenses).set({ acceptedAmount: Math.round(e.amount / 2) }).where(eq(expenses.id, e.id)).run();
  }
  if (d.targetType === "adjustment") {
    const a = tx.select().from(adjustmentRequests).where(eq(adjustmentRequests.id, d.targetId)).get();
    if (a) {
      const t = a.taskInstanceId ? tx.select().from(taskInstances).where(eq(taskInstances.id, a.taskInstanceId)).get() : undefined;
      let apply: Record<string, unknown> | null = null;
      if (resolution === "accept") apply = a.payload;
      if (resolution === "change_adjustment") apply = { factor: Number(payload?.factor) };
      if (resolution === "split_50_50" && t) {
        if (a.kind === "factor") apply = { factor: Math.round(((t.adjustmentFactor + Number(a.payload.factor)) / 2) * 100) / 100 };
        if (a.kind === "quantity") apply = { quantity: (t.quantity + Number(a.payload.quantity)) / 2 };
      }
      if (apply && t && t.status !== "locked") {
        if (apply.factor !== undefined) tx.update(taskInstances).set({ adjustmentFactor: Number(apply.factor), updatedAt: now }).where(eq(taskInstances.id, t.id)).run();
        if (apply.quantity !== undefined) tx.update(taskInstances).set({ quantity: Number(apply.quantity), updatedAt: now }).where(eq(taskInstances.id, t.id)).run();
        if (apply.sharesBp !== undefined) replaceContributions(tx, t.id, apply.sharesBp as Record<number, number>);
        if (a.kind === "descope" && resolution === "accept") {
          tx.update(taskInstances).set({ status: "cancelled", cancelReason: a.reason, cancelledAt: now, updatedAt: now }).where(eq(taskInstances.id, t.id)).run();
        }
      }
      tx.update(adjustmentRequests)
        .set({ status: apply ? "approved" : "disputed", decidedAt: now, decisionNote: `Dispute resolved: ${resolution}` })
        .where(eq(adjustmentRequests.id, a.id))
        .run();
      effects.applied = apply;
    }
  }
  tx.update(disputes)
    .set({ status: "resolved", resolution, resolutionPayload: payload, resolutionNote: note, resolvedAt: now, resolvedByBoth: byBoth })
    .where(eq(disputes.id, d.id))
    .run();
  audit(tx, ctx, byBoth ? "dispute.resolve" : "dispute.default_resolve", "dispute", d.id, d.projectId, { status: d.status }, { resolution, payload, note, effects });
}
