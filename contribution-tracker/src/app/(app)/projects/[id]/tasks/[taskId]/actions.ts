"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { bool, num, optStr, sharesFrom, str } from "@/lib/form";
import { approveAdjustment, disputeAdjustment, requestAdjustment, withdrawAdjustment, type AdjustmentKind } from "@/server/adjustments";
import { raiseDispute } from "@/server/disputes";
import { DomainError } from "@/server/errors";
import { addEvidence, reviewEvidence, type EvidenceSubject } from "@/server/evidence";
import { storeFile } from "@/server/files";
import { updatePlannedTask } from "@/server/plan";
import { blockTask, logTime, rejectSubmission, setClientApproval, startTask, submitTask, unblockTask, verifyTask } from "@/server/tasks";
import type { Ctx } from "@/server/context";

export async function startTaskAction(taskId: number, _p: ActionState, _fd: FormData) {
  let msg = "Started";
  const r = await runAction((ctx) => {
    const { warnings } = startTask(ctx, taskId);
    if (warnings.length) msg = `Started. Note: ${warnings.join("; ")}`;
  });
  return r?.ok ? { ...r, message: msg } : r;
}
export async function blockTaskAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => blockTask(ctx, taskId, str(fd, "reason")), "Marked blocked");
}
export async function unblockTaskAction(taskId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => unblockTask(ctx, taskId), "Back in progress");
}
export async function submitTaskAction(taskId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => submitTask(ctx, taskId), "Submitted for your partner to verify");
}
export async function verifyTaskAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => verifyTask(ctx, taskId, optStr(fd, "note") ?? undefined), "Verified");
}
export async function rejectSubmissionAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => rejectSubmission(ctx, taskId, str(fd, "reason")), "Sent back with your note");
}
export async function logTimeAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const hours = num(fd, "hours", "Hours");
    logTime(ctx, taskId, { workDate: str(fd, "work_date"), minutes: Math.round(hours * 60), note: str(fd, "note") });
  }, "Time logged");
}
export async function clientApprovalAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      setClientApproval(ctx, taskId, {
        status: str(fd, "status"),
        approvedByName: str(fd, "approved_by"),
        approvedAt: optStr(fd, "approved_on") ? `${str(fd, "approved_on")}T00:00:00.000Z` : undefined,
        channel: optStr(fd, "channel") ?? undefined,
        notes: str(fd, "notes"),
      }),
    "Client approval recorded",
  );
}

/** Shared by every page that collects evidence: stores the optional file, then the evidence record. */
export async function addEvidenceFor(ctx: Ctx, subjectType: EvidenceSubject, subjectId: number, projectId: number, fd: FormData) {
  if (!bool(fd, "no_secrets")) throw new DomainError("invalid", "Please confirm the evidence contains no secrets or customer personal data (or that it is redacted)");
  const description = str(fd, "description");
  if (description.length < 10 || description.length > 300) throw new DomainError("invalid", "Description must be 10–300 characters");
  let fileId: number | null = null;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    fileId = storeFile(ctx, { projectId, category: str(fd, "file_category") || "11_internal", name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }).fileId;
  }
  return addEvidence(ctx, {
    subjectType,
    subjectId,
    type: str(fd, "type"),
    url: optStr(fd, "url"),
    externalRef: optStr(fd, "external_ref"),
    fileId,
    description,
    capturedAt: optStr(fd, "captured_at"),
    containsPersonalData: bool(fd, "personal_data"),
    redacted: bool(fd, "redacted"),
    noSecretsConfirmed: true,
  });
}

export async function addTaskEvidenceAction(taskId: number, projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => addEvidenceFor(ctx, "task", taskId, projectId, fd), "Evidence added");
}
export async function reviewEvidenceAction(evidenceId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => reviewEvidence(ctx, evidenceId, { status: str(fd, "decision") === "accept" ? "accepted" : "rejected", reason: str(fd, "reason") }), "Recorded");
}
export async function updateTaskPlanAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const shares = sharesFrom(fd);
    updatePlannedTask(ctx, taskId, {
      quantity: num(fd, "quantity", "Quantity"),
      adjustmentFactor: num(fd, "factor", "Adjustment factor"),
      sharesBp: Object.keys(shares).length ? shares : undefined,
      ownDefect: bool(fd, "own_defect"),
      notes: str(fd, "notes"),
    });
  }, "Plan updated");
}
export async function requestAdjustmentAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const kind = str(fd, "kind") as AdjustmentKind;
    const payload: Record<string, unknown> =
      kind === "factor" ? { factor: num(fd, "factor", "Factor") } : kind === "quantity" ? { quantity: num(fd, "quantity", "Quantity") } : kind === "shares" ? { sharesBp: sharesFrom(fd) } : {};
    requestAdjustment(ctx, { taskInstanceId: taskId, kind, payload, reason: str(fd, "reason") });
  }, "Sent to your partner");
}
export async function approveAdjustmentAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => approveAdjustment(ctx, id), "Approved and applied");
}
export async function disputeAdjustmentAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => disputeAdjustment(ctx, id, str(fd, "reason") || "Disagree with this adjustment"), "Dispute opened");
}
export async function withdrawAdjustmentAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => withdrawAdjustment(ctx, id), "Withdrawn");
}
export async function disputeTaskAction(taskId: number, projectId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) => raiseDispute(ctx, { projectId, targetType: "task_instance", targetId: taskId, reasonCode: str(fd, "reason_code"), description: str(fd, "description") }),
    "Dispute raised. The task's points are held until it is resolved.",
  );
}
