"use server";

import { getDb } from "@/db";
import { runAction, type ActionState } from "@/lib/actions";
import { bool, int, lines, optMoney, str } from "@/lib/form";
import {
  addressRetroItem,
  addRetroItem,
  approvePostLockAdjustment,
  approveSnapshot,
  computeSnapshot,
  recordDistributionPayment,
  rejectPostLockAdjustment,
  rejectSnapshot,
  requestPostLockAdjustment,
  reverifySnapshot,
  setClosureItem,
  startClosing,
} from "@/server/closure";
import { DomainError } from "@/server/errors";

export async function startClosingAction(projectId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => startClosing(ctx, projectId), "Closing started");
}
export async function closureItemAction(projectId: number, index: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => setClosureItem(ctx, projectId, index, { done: bool(fd, "done"), note: str(fd, "note") }), "Saved");
}
export async function addRetroAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => addRetroItem(ctx, projectId, str(fd, "text")), "Added");
}
export async function addressRetroAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => addressRetroItem(ctx, id, str(fd, "note")), "Recorded");
}
export async function computeSnapshotAction(projectId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => computeSnapshot(ctx, projectId), "Snapshot computed and sent to your partner");
}
export async function approveSnapshotAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => approveSnapshot(ctx, id), "Approved");
}
export async function rejectSnapshotAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => rejectSnapshot(ctx, id, str(fd, "reason")), "Sent back");
}
export async function reverifyAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction(() => {
    const r = reverifySnapshot(getDb(), id);
    if (!r.ok) throw new DomainError("conflict", `Hash mismatch: stored ${r.storedHash.slice(0, 12)}…, recomputed ${r.recomputedHash.slice(0, 12)}…`);
  }, "Recomputed from stored inputs: the hash matches.");
}
export async function distributionPaidAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => recordDistributionPayment(ctx, id, { paidOn: str(fd, "paid_on"), bankReference: str(fd, "reference") }), "Payout recorded");
}
export async function requestPostLockAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const points = lines(fd, "points").map((l) => {
      const [m, pts, ...note] = l.split(/[,;]\s*/);
      return { memberId: Number(m), points: Number(pts), note: note.join(", ") };
    });
    const expenseAmount = optMoney(fd, "expense_amount", "Expense");
    requestPostLockAdjustment(ctx, projectId, {
      reason: str(fd, "reason"),
      revenueDeltaPaise: str(fd, "revenue_sign") === "minus" ? -optMoney(fd, "revenue", "Revenue") : optMoney(fd, "revenue", "Revenue"),
      expenses: expenseAmount ? [{ amountPaise: expenseAmount, paidBy: str(fd, "expense_paid_by") === "studio" ? null : int(fd, "expense_paid_by", "Paid by"), description: str(fd, "expense_description") }] : [],
      points: points.filter((x) => Number.isFinite(x.memberId) && Number.isFinite(x.points) && x.points !== 0),
    });
  }, "Requested. Every partner must approve it.");
}
export async function approvePostLockAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => approvePostLockAdjustment(ctx, id), "Approved");
}
export async function rejectPostLockAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => rejectPostLockAdjustment(ctx, id, str(fd, "reason") || "Rejected"), "Rejected");
}
