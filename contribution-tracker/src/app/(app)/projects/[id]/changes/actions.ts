"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { bool, int, num, optMoney, str } from "@/lib/form";
import { addChangeRequestTask, advanceChangeRequest, assessChangeRequest, invoiceChangeRequest, logChangeRequest } from "@/server/changeRequests";
import { addEvidenceFor } from "../tasks/[taskId]/actions";

type Cls = "bug" | "revision" | "change";

export async function logCrAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) => logChangeRequest(ctx, projectId, { description: str(fd, "description"), requestedByClientName: str(fd, "requested_by"), requestedAt: str(fd, "requested_at"), classification: str(fd, "classification") as Cls }),
    "Logged. Reply to the client: “Thanks, I've logged this and will send the impact.”",
  );
}
export async function assessCrAction(id: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      assessChangeRequest(ctx, id, {
        classification: str(fd, "classification") as Cls,
        estimateHours: num(fd, "hours", "Estimate"),
        priceExGst: optMoney(fd, "price", "Price"),
        timelineImpactDays: int(fd, "days", "Timeline impact"),
        noCharge: bool(fd, "no_charge"),
      }),
    "Assessed",
  );
}
export async function advanceCrAction(id: number, to: "quoted" | "approved" | "declined" | "done", _p: ActionState, fd: FormData) {
  return runAction((ctx) => advanceChangeRequest(ctx, id, to, str(fd, "note")), "Updated");
}
export async function crEvidenceAction(id: number, projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => addEvidenceFor(ctx, "change_request", id, projectId, fd), "Approval attached");
}
export async function crTaskAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => addChangeRequestTask(ctx, id, { name: str(fd, "name"), categoryCode: str(fd, "category"), defaultPoints: num(fd, "points", "Points"), ownerMemberId: int(fd, "owner", "Owner") }), "Task added");
}
export async function crInvoiceAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => invoiceChangeRequest(ctx, id, { issueDate: str(fd, "issue_date"), dueDate: str(fd, "due_date") }), "Draft invoice created on the Finance tab");
}
