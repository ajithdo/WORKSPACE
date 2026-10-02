"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { bool, int, money, optMoney, optStr, str } from "@/lib/form";
import {
  addExpense,
  approveExpense,
  cancelInvoice,
  createInvoice,
  issueInvoice,
  recordPayment,
  recordTdsCertificate,
  rejectExpense,
  requestReserveRelease,
  verifyPayment,
  writeOffInvoice,
} from "@/server/finance";
import { storeFile } from "@/server/files";

export async function createInvoiceAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      createInvoice(ctx, projectId, {
        type: str(fd, "type"),
        issueDate: str(fd, "issue_date"),
        dueDate: str(fd, "due_date"),
        acceptanceDate: optStr(fd, "acceptance_date"),
        amountExGst: money(fd, "amount", "Amount"),
        tdsExpectedRateBp: int(fd, "tds", "TDS rate"),
        milestoneCode: optStr(fd, "milestone"),
        notes: str(fd, "notes"),
      }),
    "Draft invoice created. Issue it to give it a number.",
  );
}
export async function issueInvoiceAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => issueInvoice(ctx, id), "Issued");
}
export async function cancelInvoiceAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => cancelInvoice(ctx, id, str(fd, "reason") || "Cancelled"), "Cancelled");
}
export async function writeOffAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => writeOffInvoice(ctx, id, str(fd, "reason")), "Balance written off");
}
export async function recordPaymentAction(invoiceId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      recordPayment(ctx, invoiceId, {
        receivedDate: str(fd, "received_date"),
        amountReceived: money(fd, "amount", "Amount received"),
        tdsDeducted: optMoney(fd, "tds", "TDS deducted"),
        bankReference: str(fd, "reference"),
        mode: str(fd, "mode"),
        notes: str(fd, "notes"),
      }),
    "Payment recorded. Your partner checks it against the bank statement.",
  );
}
export async function verifyPaymentAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => verifyPayment(ctx, id), "Payment verified");
}
export async function tdsCertificateAction(id: number, projectId: number, _p: ActionState, fd: FormData) {
  return runAction(async (ctx) => {
    let fileId: number | null = null;
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) fileId = storeFile(ctx, { projectId, category: "09_finance", name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()), allowClosedProject: true }).fileId;
    recordTdsCertificate(ctx, id, { fileId });
  }, "TDS certificate recorded");
}
export async function addExpenseAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction(async (ctx) => {
    let receiptFileId: number | null = null;
    const file = fd.get("receipt");
    if (file instanceof File && file.size > 0) receiptFileId = storeFile(ctx, { projectId, category: "09_finance", name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }).fileId;
    const paidBy = str(fd, "paid_by");
    addExpense(ctx, {
      projectId,
      expenseDate: str(fd, "date"),
      vendor: str(fd, "vendor"),
      description: str(fd, "description"),
      amount: money(fd, "amount", "Amount"),
      gstPaid: optMoney(fd, "gst", "GST paid"),
      paidByMemberId: paidBy === "studio" ? null : Number(paidBy),
      reimbursable: paidBy !== "studio",
      billableToClient: bool(fd, "billable"),
      receiptFileId,
    });
  }, "Expense added. Your partner approves it.");
}
export async function approveExpenseAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => approveExpense(ctx, id), "Approved");
}
export async function rejectExpenseAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => rejectExpense(ctx, id, str(fd, "reason")), "Rejected");
}
export async function reserveReleaseAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => requestReserveRelease(ctx, { projectId, amount: money(fd, "amount", "Amount"), purpose: str(fd, "purpose") }), "Requested. Your partner approves it on the Studio page.");
}
