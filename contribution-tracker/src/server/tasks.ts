import { and, eq, inArray, sql } from "drizzle-orm";
import { assertTransition, evidenceCheck, plannedPoints, sharesValid, verifierEligibility } from "@/domain/taskRules";
import type { TaskStatus } from "@/domain/types";
import type { DbOrTx } from "@/db";
import { clientApprovals, evidence, taskInstances, timeEntries } from "@/db/schema";
import { allApproved, castVote, hasVoted } from "./approvals";
import type { Ctx } from "./context";
import { addDays, iso } from "./context";
import {
  assertDate,
  assertProjectMember,
  assertProjectOpen,
  audit,
  contributionsOf,
  loadProject,
  loadTask,
  nonEmpty,
  projectConfig,
  projectMemberIds,
  requireActor,
  type TaskRow,
} from "./common";
import { DomainError } from "./errors";
import { gateBlockForTask } from "./milestones";

function setStatus(tx: DbOrTx, ctx: Ctx, t: TaskRow, to: TaskStatus, extra: Partial<typeof taskInstances.$inferInsert> = {}) {
  const p = loadProject(tx, t.projectId);
  assertTransition(t.status as TaskStatus, to, projectConfig(tx, p).task_transitions);
  tx.update(taskInstances)
    .set({ status: to, updatedAt: iso(ctx.now), ...extra })
    .where(eq(taskInstances.id, t.id))
    .run();
}

function assertContributor(tx: DbOrTx, t: TaskRow, memberId: number, verb: string) {
  if (!contributionsOf(tx, t.id).some((c) => c.memberId === memberId)) {
    throw new DomainError("forbidden", `Only a contributor on this task can ${verb} it`);
  }
}

/** Evidence counted for submission round n: items from rounds ≤ n that were not rejected. */
export function evidenceForRound(tx: DbOrTx, taskId: number, round: number) {
  return tx
    .select()
    .from(evidence)
    .where(and(eq(evidence.subjectType, "task"), eq(evidence.subjectId, taskId)))
    .all()
    .filter((e) => e.submissionRound <= round && e.verificationStatus !== "rejected");
}

export function startTask(ctx: Ctx, taskId: number): { warnings: string[] } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    if (t.status === "proposed") throw new DomainError("conflict", "This task is still a proposal waiting for approval");
    assertContributor(tx, t, actor, "start");
    const gate = gateBlockForTask(tx, p, t);
    if (gate) {
      throw new DomainError("gate_blocked", `${gate.milestoneName} is not complete yet — waiting on ${gate.missing.join(", ")}`);
    }
    const warnings: string[] = [];
    if (t.dependsOn.length) {
      const deps = tx
        .select({ code: taskInstances.code, name: taskInstances.name, status: taskInstances.status })
        .from(taskInstances)
        .where(and(eq(taskInstances.projectId, p.id), inArray(taskInstances.code, t.dependsOn)))
        .all();
      for (const d of deps) {
        if (!["verified", "locked", "cancelled"].includes(d.status)) warnings.push(`Depends on ${d.code} (${d.name}), which is not verified yet`);
      }
    }
    setStatus(tx, ctx, t, "in_progress", { startedAt: t.startedAt ?? iso(ctx.now), blockedReason: null });
    audit(tx, ctx, "task.start", "task", t.id, p.id, { status: t.status }, { status: "in_progress", warnings });
    return { warnings };
  });
}

export function blockTask(ctx: Ctx, taskId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    setStatus(tx, ctx, t, "blocked", { blockedReason: why });
    audit(tx, ctx, "task.block", "task", t.id, p.id, { status: t.status }, { status: "blocked", reason: why });
  });
}

export function unblockTask(ctx: Ctx, taskId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    setStatus(tx, ctx, t, "in_progress", { blockedReason: null });
    audit(tx, ctx, "task.unblock", "task", t.id, p.id, { status: "blocked" }, { status: "in_progress" });
  });
}

export function submitTask(ctx: Ctx, taskId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertContributor(tx, t, actor, "submit");
    const shares = Object.fromEntries(contributionsOf(tx, t.id).map((c) => [c.memberId, c.shareBp]));
    if (!sharesValid(shares)) throw new DomainError("invalid", "Contributor shares must add up to 100% before submitting");
    const round = t.submissionRound + 1;
    const items = evidenceForRound(tx, t.id, round);
    if (items.length === 0) throw new DomainError("evidence_insufficient", "Add evidence before submitting this task");
    const rule = projectConfig(tx, p).calculation.evidence_rule;
    const check = evidenceCheck(plannedPoints(t.defaultPoints, t.quantity, t.adjustmentFactor), items, rule);
    if (!check.ok) throw new DomainError("evidence_insufficient", check.reason ?? "Not enough evidence");
    setStatus(tx, ctx, t, "submitted", { submittedAt: iso(ctx.now), submittedBy: actor, submissionRound: round, rejectionReason: null });
    audit(tx, ctx, "task.submit", "task", t.id, p.id, { status: t.status }, { status: "submitted", round, evidence: items.map((e) => e.id) });
  });
}

function eligibility(tx: DbOrTx, t: TaskRow) {
  const members = projectMemberIds(tx, t.projectId);
  const contributors = contributionsOf(tx, t.id).map((c) => c.memberId);
  return verifierEligibility(members, contributors, t.submittedBy ?? -1);
}

export function canVerifyTask(tx: DbOrTx, t: TaskRow, memberId: number): boolean {
  if (t.status !== "submitted") return false;
  const e = eligibility(tx, t);
  if (!e.eligible.includes(memberId)) return false;
  return e.mode === "independent" || !hasVoted(tx, "task_verify", t.id, t.submissionRound, memberId);
}

export function verifyTask(ctx: Ctx, taskId: number, note?: string): { status: "verified" | "awaiting_other_confirmations"; warnings: string[] } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    if (t.status !== "submitted") throw new DomainError("conflict", "Only submitted tasks can be verified");
    const e = eligibility(tx, t);
    if (!e.eligible.includes(actor)) {
      throw new DomainError("forbidden", t.submittedBy === actor ? "You cannot verify a task you submitted" : "You cannot verify a task you contributed to; the other partner verifies it");
    }
    const items = evidenceForRound(tx, t.id, t.submissionRound);
    const check = evidenceCheck(plannedPoints(t.defaultPoints, t.quantity, t.adjustmentFactor), items, projectConfig(tx, p).calculation.evidence_rule);
    if (!check.ok) throw new DomainError("evidence_insufficient", `${check.reason ?? "Not enough evidence"}. Reject the submission instead.`);
    const now = iso(ctx.now);
    tx.update(evidence)
      .set({ verificationStatus: "accepted", verifiedBy: actor, verifiedAt: now })
      .where(inArray(evidence.id, items.filter((i) => i.verificationStatus === "pending").map((i) => i.id)))
      .run();
    const warnings: string[] = [];
    if (t.clientApproval === "Yes") {
      const a = tx.select().from(clientApprovals).where(eq(clientApprovals.taskInstanceId, t.id)).get();
      if (a?.status !== "approved" && a?.status !== "deemed_approved") warnings.push("The client's written approval is not recorded yet; milestones wait for it");
    }
    if (e.mode === "joint") {
      castVote(tx, { subjectType: "task_verify", subjectId: t.id, round: t.submissionRound, memberId: actor, decision: "approve", note, now: ctx.now, label: "task" });
      if (!allApproved(tx, "task_verify", t.id, t.submissionRound, e.eligible)) {
        audit(tx, ctx, "task.confirm", "task", t.id, p.id, undefined, { round: t.submissionRound, note });
        return { status: "awaiting_other_confirmations" as const, warnings };
      }
    }
    setStatus(tx, ctx, t, "verified", { verifiedBy: actor, verifiedAt: now });
    audit(tx, ctx, "task.verify", "task", t.id, p.id, { status: "submitted" }, { status: "verified", mode: e.mode, note: note ?? null });
    return { status: "verified" as const, warnings };
  });
}

export function rejectSubmission(ctx: Ctx, taskId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    if (t.status !== "submitted") throw new DomainError("conflict", "Only submitted tasks can be sent back");
    if (!eligibility(tx, t).eligible.includes(actor)) throw new DomainError("forbidden", "Only the verifying partner can send this task back");
    setStatus(tx, ctx, t, "in_progress", { rejectionReason: why });
    audit(tx, ctx, "task.reject", "task", t.id, p.id, { status: "submitted" }, { status: "in_progress", reason: why });
  });
}

export function logTime(ctx: Ctx, taskId: number, input: { workDate: string; minutes: number; note?: string }) {
  const actor = requireActor(ctx);
  assertDate(input.workDate, "Work date");
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 24 * 60) throw new DomainError("invalid", "Minutes must be between 1 and 1440");
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (t.status === "cancelled") throw new DomainError("conflict", "This task is cancelled");
    const id = tx
      .insert(timeEntries)
      .values({ taskInstanceId: t.id, memberId: actor, workDate: input.workDate, minutes: input.minutes, note: input.note?.trim() ?? "", createdAt: iso(ctx.now) })
      .returning({ id: timeEntries.id })
      .get().id;
    audit(tx, ctx, "task.log_time", "time_entry", id, p.id, undefined, { taskId: t.id, ...input });
  });
}

export function hoursLogged(tx: DbOrTx, taskId: number): number {
  const r = tx
    .select({ m: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)` })
    .from(timeEntries)
    .where(eq(timeEntries.taskInstanceId, taskId))
    .get();
  return (r?.m ?? 0) / 60;
}

export interface ClientApprovalInput {
  status: string;
  approvedByName?: string;
  approvedAt?: string;
  channel?: string;
  evidenceId?: number | null;
  notes?: string;
}

export function setClientApproval(ctx: Ctx, taskId: number, input: ClientApprovalInput) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const t = loadTask(tx, taskId);
    const p = loadProject(tx, t.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (t.clientApproval === "No") throw new DomainError("invalid", "This task does not need client approval");
    const cfg = projectConfig(tx, p);
    if (!cfg.client_approval_status.includes(input.status)) throw new DomainError("invalid", "Unknown approval status");
    const current = tx.select().from(clientApprovals).where(eq(clientApprovals.taskInstanceId, t.id)).get();
    const now = iso(ctx.now);
    const next = {
      status: input.status,
      requestedAt: current?.requestedAt ?? (input.status === "pending" ? now : null),
      approvedByName: input.approvedByName?.trim() ?? current?.approvedByName ?? "",
      approvedAt: input.approvedAt ?? current?.approvedAt ?? null,
      channel: input.channel ?? current?.channel ?? null,
      evidenceId: input.evidenceId !== undefined ? input.evidenceId : (current?.evidenceId ?? null),
      notes: input.notes ?? current?.notes ?? "",
      updatedBy: actor,
      updatedAt: now,
    };
    if (input.status === "approved") {
      if (!next.approvedByName) throw new DomainError("invalid", "Record who approved (the client's name)");
      if (!next.channel || !cfg.approval_channels.includes(next.channel)) {
        throw new DomainError("invalid", `Approval must come by ${cfg.approval_channels.join(", ").replaceAll("_", " ")}`);
      }
      next.approvedAt = next.approvedAt ?? now;
    }
    if (input.status === "deemed_approved") {
      if (!p.deemedAcceptanceClause || !p.deemedAcceptanceDays) throw new DomainError("invalid", "Deemed approval needs a deemed-acceptance clause in the contract (set it on the project)");
      if (!next.requestedAt) throw new DomainError("invalid", "Mark the approval as requested first; deemed approval counts from that date");
      const due = addDays(new Date(next.requestedAt), p.deemedAcceptanceDays);
      if (ctx.now < due) throw new DomainError("conflict", `Deemed approval is possible from ${iso(due).slice(0, 10)}`);
      next.approvedAt = now;
      next.approvedByName = next.approvedByName || "Deemed (contract clause)";
    }
    if (current) tx.update(clientApprovals).set(next).where(eq(clientApprovals.id, current.id)).run();
    else tx.insert(clientApprovals).values({ taskInstanceId: t.id, ...next }).run();
    audit(tx, ctx, "task.client_approval", "task", t.id, p.id, current ?? undefined, next);
  });
}
