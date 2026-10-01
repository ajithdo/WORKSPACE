import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { findSecrets, SECRET_KIND_LABELS } from "@/domain/secrets";
import { financialYearLabel, formatInvoiceNumber, msmeDueDate, paymentRevenue, splitGst } from "@/domain/money";
import type { AppDb, DbOrTx } from "@/db";
import { expenses, invoices, payments, reserveLedger, studio } from "@/db/schema";
import type { Ctx } from "./context";
import { iso, isoDate } from "./context";
import { assertDate, assertProjectMember, assertProjectOpen, audit, loadProject, nonEmpty, projectConfig, requireActor } from "./common";
import { DomainError } from "./errors";

export type InvoiceRow = typeof invoices.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;

function loadInvoice(tx: DbOrTx, id: number): InvoiceRow {
  const i = tx.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!i) throw new DomainError("not_found", "Invoice not found");
  return i;
}

function studioRow(tx: DbOrTx) {
  const s = tx.select().from(studio).where(eq(studio.id, 1)).get();
  if (!s) throw new DomainError("conflict", "Set up the studio first");
  return s;
}

const positivePaise = (n: number, label: string) => {
  if (!Number.isSafeInteger(n) || n <= 0) throw new DomainError("invalid", `${label} must be more than zero`);
};

export interface InvoiceInput {
  type: string;
  issueDate: string;
  dueDate: string;
  acceptanceDate?: string | null;
  amountExGst: number;
  tdsExpectedRateBp?: number;
  milestoneCode?: string | null;
  changeRequestId?: number | null;
  notes?: string;
}

export function createInvoice(ctx: Ctx, projectId: number, input: InvoiceInput): { invoiceId: number } {
  const actor = requireActor(ctx);
  assertDate(input.issueDate, "Issue date");
  assertDate(input.dueDate, "Due date");
  if (input.acceptanceDate) assertDate(input.acceptanceDate, "Acceptance date");
  if (input.dueDate < input.issueDate) throw new DomainError("invalid", "Due date cannot be before the issue date");
  positivePaise(input.amountExGst, "Amount");
  return ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (p.kind === "studio") throw new DomainError("invalid", "Studio projects are funded from the reserve, not invoiced");
    const cfg = projectConfig(tx, p);
    if (!cfg.invoice_types.includes(input.type)) throw new DomainError("invalid", "Unknown invoice type");
    const tdsRate = input.tdsExpectedRateBp ?? 0;
    const allowedTds = Object.values(cfg.tds_rates).map((r) => Math.round(r * 10000));
    if (!allowedTds.includes(tdsRate)) throw new DomainError("invalid", "Unknown TDS rate");
    const st = studioRow(tx);
    const rate = p.gstRegistered ? p.gstRateBp : 0;
    const intra = !st.stateCode || !p.placeOfSupplyState || st.stateCode === p.placeOfSupplyState;
    const gst = splitGst(input.amountExGst, rate, intra);
    const now = iso(ctx.now);
    const id = tx
      .insert(invoices)
      .values({
        projectId: p.id,
        type: input.type,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        acceptanceDate: input.acceptanceDate ?? input.issueDate,
        amountExGst: input.amountExGst,
        gstRateBp: rate,
        cgst: gst.cgst,
        sgst: gst.sgst,
        igst: gst.igst,
        total: gst.total,
        tdsExpectedRateBp: tdsRate,
        status: "draft",
        milestoneCode: input.milestoneCode ?? null,
        changeRequestId: input.changeRequestId ?? null,
        notes: input.notes?.trim() ?? "",
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: invoices.id })
      .get().id;
    audit(tx, ctx, "invoice.create", "invoice", id, p.id, undefined, { ...input, ...gst });
    return { invoiceId: id };
  });
}

/** Assigns the next number in the financial year of the issue date and marks the invoice sent. */
export function issueInvoice(ctx: Ctx, invoiceId: number): { number: string } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const inv = loadInvoice(tx, invoiceId);
    const p = loadProject(tx, inv.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (inv.status !== "draft") throw new DomainError("conflict", "Only draft invoices can be issued");
    const st = studioRow(tx);
    const fy = financialYearLabel(inv.issueDate);
    const last = tx.select({ seq: invoices.seq }).from(invoices).where(eq(invoices.fyLabel, fy)).orderBy(desc(invoices.seq)).get();
    const seq = (last?.seq ?? 0) + 1;
    let number: string;
    try {
      number = formatInvoiceNumber(st.invoicePrefix, fy, seq);
    } catch (e) {
      throw new DomainError("invalid", (e as Error).message);
    }
    const msme = st.msmeRegistered && p.msmeApplicable ? msmeDueDate(inv.dueDate, inv.acceptanceDate, projectConfig(tx, p).calculation.msme_payment_days) : null;
    tx.update(invoices).set({ number, fyLabel: fy, seq, status: "sent", sentAt: iso(ctx.now), msmeDueDate: msme, updatedAt: iso(ctx.now) }).where(eq(invoices.id, invoiceId)).run();
    audit(tx, ctx, "invoice.issue", "invoice", invoiceId, p.id, { status: "draft" }, { status: "sent", number, msmeDueDate: msme });
    return { number };
  });
}

function settledGross(tx: DbOrTx, invoiceId: number): number {
  const r = tx
    .select({ s: sql<number>`coalesce(sum(${payments.amountReceived} + ${payments.tdsDeducted}), 0)` })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId))
    .get();
  return r?.s ?? 0;
}

export interface PaymentInput {
  receivedDate: string;
  amountReceived: number;
  tdsDeducted: number;
  bankReference: string;
  mode: string;
  notes?: string;
}

export function recordPayment(ctx: Ctx, invoiceId: number, input: PaymentInput): { paymentId: number } {
  const actor = requireActor(ctx);
  assertDate(input.receivedDate, "Received date");
  positivePaise(input.amountReceived, "Amount received");
  if (!Number.isSafeInteger(input.tdsDeducted) || input.tdsDeducted < 0) throw new DomainError("invalid", "TDS cannot be negative");
  const ref = nonEmpty(input.bankReference, "Bank reference (UTR, cheque number or UPI ref)");
  return ctx.db.transaction((tx) => {
    const inv = loadInvoice(tx, invoiceId);
    const p = loadProject(tx, inv.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (!["sent", "part_paid"].includes(inv.status) || inv.writtenOffReason) throw new DomainError("conflict", "Payments can only be recorded against issued, unpaid invoices");
    if (!projectConfig(tx, p).payment_modes.includes(input.mode)) throw new DomainError("invalid", "Unknown payment mode");
    const already = settledGross(tx, invoiceId);
    if (already + input.amountReceived + input.tdsDeducted > inv.total) {
      throw new DomainError("invalid", "This payment is more than the balance due on the invoice");
    }
    const split = paymentRevenue({ amountReceived: input.amountReceived, tdsDeducted: input.tdsDeducted }, { total: inv.total, gstTotal: inv.cgst + inv.sgst + inv.igst });
    const id = tx
      .insert(payments)
      .values({
        invoiceId,
        projectId: p.id,
        receivedDate: input.receivedDate,
        amountReceived: input.amountReceived,
        tdsDeducted: input.tdsDeducted,
        gstComponent: split.gstComponent,
        revenueExGst: split.revenueExGst,
        bankReference: ref,
        mode: input.mode,
        recordedBy: actor,
        recordedAt: iso(ctx.now),
        tdsCertificateStatus: input.tdsDeducted > 0 ? "pending" : "not_applicable",
        notes: input.notes?.trim() ?? "",
      })
      .returning({ id: payments.id })
      .get().id;
    const settled = already + split.grossSettled;
    const status = settled >= inv.total ? "paid" : "part_paid";
    tx.update(invoices).set({ status, updatedAt: iso(ctx.now) }).where(eq(invoices.id, invoiceId)).run();
    audit(tx, ctx, "payment.record", "payment", id, p.id, undefined, { invoiceId, ...input, ...split, invoiceStatus: status });
    return { paymentId: id };
  });
}

export function verifyPayment(ctx: Ctx, paymentId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const pay = tx.select().from(payments).where(eq(payments.id, paymentId)).get();
    if (!pay) throw new DomainError("not_found", "Payment not found");
    const p = loadProject(tx, pay.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (pay.verifiedBy) throw new DomainError("conflict", "This payment is already verified");
    if (pay.recordedBy === actor) throw new DomainError("forbidden", "Only the other partner can verify a payment you recorded (check it against the bank statement)");
    tx.update(payments).set({ verifiedBy: actor, verifiedAt: iso(ctx.now) }).where(eq(payments.id, paymentId)).run();
    audit(tx, ctx, "payment.verify", "payment", paymentId, p.id, undefined, { verifiedBy: actor });
  });
}

export function recordTdsCertificate(ctx: Ctx, paymentId: number, input: { fileId?: number | null }) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const pay = tx.select().from(payments).where(eq(payments.id, paymentId)).get();
    if (!pay) throw new DomainError("not_found", "Payment not found");
    const p = loadProject(tx, pay.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (pay.tdsDeducted <= 0) throw new DomainError("invalid", "No TDS was deducted on this payment");
    tx.update(payments).set({ tdsCertificateStatus: "received", tdsCertificateFileId: input.fileId ?? null }).where(eq(payments.id, paymentId)).run();
    audit(tx, ctx, "payment.tds_certificate", "payment", paymentId, p.id, { status: pay.tdsCertificateStatus }, { status: "received", fileId: input.fileId ?? null });
  });
}

export function writeOffInvoice(ctx: Ctx, invoiceId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const inv = loadInvoice(tx, invoiceId);
    const p = loadProject(tx, inv.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (!["sent", "part_paid"].includes(inv.status)) throw new DomainError("conflict", "Only issued, unpaid invoices can be written off");
    tx.update(invoices).set({ writtenOffReason: why, updatedAt: iso(ctx.now) }).where(eq(invoices.id, invoiceId)).run();
    audit(tx, ctx, "invoice.write_off", "invoice", invoiceId, p.id, { status: inv.status }, { writtenOffReason: why, balance: inv.total - settledGross(tx, invoiceId) });
  });
}

export function cancelInvoice(ctx: Ctx, invoiceId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const inv = loadInvoice(tx, invoiceId);
    const p = loadProject(tx, inv.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (!["draft", "sent"].includes(inv.status) || settledGross(tx, invoiceId) > 0) throw new DomainError("conflict", "Invoices with payments cannot be cancelled; write off the balance instead");
    tx.update(invoices).set({ status: "cancelled", cancelledReason: why, updatedAt: iso(ctx.now) }).where(eq(invoices.id, invoiceId)).run();
    audit(tx, ctx, "invoice.cancel", "invoice", invoiceId, p.id, { status: inv.status }, { status: "cancelled", reason: why });
  });
}

export interface ExpenseInput {
  projectId: number | null;
  expenseDate: string;
  vendor: string;
  description: string;
  amount: number;
  gstPaid?: number;
  paidByMemberId: number | null;
  reimbursable: boolean;
  billableToClient?: boolean;
  receiptFileId?: number | null;
}

export function addExpense(ctx: Ctx, input: ExpenseInput): { expenseId: number } {
  const actor = requireActor(ctx);
  assertDate(input.expenseDate, "Expense date");
  positivePaise(input.amount, "Amount");
  const vendor = nonEmpty(input.vendor, "Vendor");
  const description = nonEmpty(input.description, "Description");
  const hit = findSecrets(`${vendor} ${description}`)[0];
  if (hit) throw new DomainError("invalid", `This looks like it contains ${SECRET_KIND_LABELS[hit.kind] ?? "a secret"}. Remove it.`);
  return ctx.db.transaction((tx) => {
    if (input.projectId !== null) {
      const p = loadProject(tx, input.projectId);
      assertProjectOpen(p);
      assertProjectMember(tx, p.id, actor);
      if (input.paidByMemberId !== null) assertProjectMember(tx, p.id, input.paidByMemberId);
    }
    const id = tx
      .insert(expenses)
      .values({
        projectId: input.projectId,
        expenseDate: input.expenseDate,
        vendor,
        description,
        amount: input.amount,
        gstPaid: input.gstPaid ?? 0,
        paidByMemberId: input.paidByMemberId,
        reimbursable: input.paidByMemberId !== null && input.reimbursable,
        billableToClient: input.billableToClient ?? false,
        receiptFileId: input.receiptFileId ?? null,
        status: "pending",
        createdBy: actor,
        createdAt: iso(ctx.now),
      })
      .returning({ id: expenses.id })
      .get().id;
    audit(tx, ctx, "expense.add", "expense", id, input.projectId, undefined, input);
    return { expenseId: id };
  });
}

function loadExpense(tx: DbOrTx, id: number): ExpenseRow {
  const e = tx.select().from(expenses).where(eq(expenses.id, id)).get();
  if (!e) throw new DomainError("not_found", "Expense not found");
  return e;
}

function assertExpenseReviewer(tx: DbOrTx, e: ExpenseRow, actor: number) {
  if (e.projectId !== null) {
    const p = loadProject(tx, e.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
  }
  if (e.createdBy === actor || e.paidByMemberId === actor) throw new DomainError("forbidden", "Only the other partner can approve or reject this expense");
  if (e.status !== "pending") throw new DomainError("conflict", "This expense was already reviewed");
}

export function approveExpense(ctx: Ctx, expenseId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const e = loadExpense(tx, expenseId);
    assertExpenseReviewer(tx, e, actor);
    tx.update(expenses).set({ status: "approved", approvedBy: actor, approvedAt: iso(ctx.now) }).where(eq(expenses.id, expenseId)).run();
    audit(tx, ctx, "expense.approve", "expense", expenseId, e.projectId, { status: "pending" }, { status: "approved" });
  });
}

export function rejectExpense(ctx: Ctx, expenseId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const e = loadExpense(tx, expenseId);
    assertExpenseReviewer(tx, e, actor);
    tx.update(expenses).set({ status: "rejected", approvedBy: actor, approvedAt: iso(ctx.now), rejectionReason: why }).where(eq(expenses.id, expenseId)).run();
    audit(tx, ctx, "expense.reject", "expense", expenseId, e.projectId, { status: "pending" }, { status: "rejected", reason: why });
  });
}

export function reserveBalance(db: DbOrTx): number {
  const rows = db.select().from(reserveLedger).where(eq(reserveLedger.status, "approved")).all();
  return rows.reduce((s, r) => s + (r.direction === "in" ? r.amount : -r.amount), 0);
}

/** Releases reserve money (to a studio project, tools, taxes). The other partner approves. */
export function requestReserveRelease(ctx: Ctx, input: { projectId: number | null; amount: number; purpose: string; entryDate?: string }): { entryId: number } {
  const actor = requireActor(ctx);
  positivePaise(input.amount, "Amount");
  const purpose = nonEmpty(input.purpose, "Purpose");
  return ctx.db.transaction((tx) => {
    if (input.projectId !== null) {
      const p = loadProject(tx, input.projectId);
      assertProjectOpen(p);
    }
    if (input.amount > reserveBalance(tx)) throw new DomainError("invalid", "The reserve does not have that much money");
    const id = tx
      .insert(reserveLedger)
      .values({ entryDate: input.entryDate ?? isoDate(ctx.now), projectId: input.projectId, amount: input.amount, direction: "out", purpose, status: "pending", createdBy: actor, createdAt: iso(ctx.now) })
      .returning({ id: reserveLedger.id })
      .get().id;
    audit(tx, ctx, "reserve.request_release", "reserve_entry", id, input.projectId, undefined, input);
    return { entryId: id };
  });
}

export function decideReserveEntry(ctx: Ctx, entryId: number, decision: "approved" | "rejected") {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const e = tx.select().from(reserveLedger).where(eq(reserveLedger.id, entryId)).get();
    if (!e) throw new DomainError("not_found", "Reserve entry not found");
    if (e.status !== "pending") throw new DomainError("conflict", "Already decided");
    if (e.createdBy === actor) throw new DomainError("forbidden", "Only the other partner can approve this release");
    if (decision === "approved" && e.direction === "out" && e.amount > reserveBalance(tx)) throw new DomainError("invalid", "The reserve no longer has that much money");
    tx.update(reserveLedger).set({ status: decision, approvedBy: actor }).where(eq(reserveLedger.id, entryId)).run();
    audit(tx, ctx, `reserve.${decision === "approved" ? "approve" : "reject"}`, "reserve_entry", entryId, e.projectId, { status: "pending" }, { status: decision });
  });
}

export function isSettled(inv: InvoiceRow): boolean {
  return inv.status === "paid" || inv.status === "cancelled" || !!inv.writtenOffReason;
}

export function overdueOn(inv: InvoiceRow, today: string): boolean {
  if (inv.status === "draft" || isSettled(inv)) return false;
  return today > (inv.msmeDueDate ?? inv.dueDate);
}

export function financeSummary(db: AppDb | DbOrTx, projectId: number, today?: string) {
  const invs = db.select().from(invoices).where(eq(invoices.projectId, projectId)).all();
  const pays = db.select().from(payments).where(eq(payments.projectId, projectId)).all();
  const exps = db.select().from(expenses).where(eq(expenses.projectId, projectId)).all();
  const issued = invs.filter((i) => i.status !== "draft" && i.status !== "cancelled");
  const settledByInvoice = new Map<number, number>();
  for (const p of pays) settledByInvoice.set(p.invoiceId, (settledByInvoice.get(p.invoiceId) ?? 0) + p.amountReceived + p.tdsDeducted);
  const t = today ?? new Date().toISOString().slice(0, 10);
  return {
    invoicedTotal: issued.reduce((s, i) => s + i.total, 0),
    invoicedExGst: issued.reduce((s, i) => s + i.amountExGst, 0),
    cashReceived: pays.reduce((s, p) => s + p.amountReceived, 0),
    revenueExGstVerified: pays.filter((p) => p.verifiedBy).reduce((s, p) => s + p.revenueExGst, 0),
    revenueAwaitingVerification: pays.filter((p) => !p.verifiedBy).reduce((s, p) => s + p.revenueExGst, 0),
    gstCollected: pays.reduce((s, p) => s + p.gstComponent, 0),
    tdsReceivable: pays.reduce((s, p) => s + p.tdsDeducted, 0),
    tdsCertificatesPending: pays.filter((p) => p.tdsCertificateStatus === "pending").length,
    outstanding: issued.filter((i) => !isSettled(i)).reduce((s, i) => s + i.total - (settledByInvoice.get(i.id) ?? 0), 0),
    unsettledInvoices: issued.filter((i) => !isSettled(i)).length,
    draftInvoices: invs.filter((i) => i.status === "draft").length,
    overdue: issued.filter((i) => overdueOn(i, t)).map((i) => i.id),
    expensesApproved: exps.filter((e) => e.status === "approved").reduce((s, e) => s + (e.acceptedAmount ?? e.amount), 0),
    expensesPending: exps.filter((e) => e.status === "pending").length,
    settledByInvoice,
  };
}

export function paidInvoicesExist(db: DbOrTx, projectId: number): boolean {
  return !!db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.projectId, projectId), isNotNull(payments.verifiedBy)))
    .get();
}
