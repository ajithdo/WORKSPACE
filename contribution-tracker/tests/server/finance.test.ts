import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, payments } from "@/db/schema";
import { liveContribution } from "@/server/contribution";
import { addExpense, approveExpense, createInvoice, financeSummary, issueInvoice, recordPayment, verifyPayment, writeOffInvoice } from "@/server/finance";
import { bootstrap } from "../fixtures";

describe("invoices", () => {
  it("numbers issued invoices per financial year with intra-state GST", () => {
    const f = bootstrap();
    const i1 = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 3_000_000, tdsExpectedRateBp: 1000 });
    const draft = createInvoice(f.at(f.a), f.projectId, { type: "milestone", issueDate: "2026-10-02", dueDate: "2026-10-09", amountExGst: 1_000_000 });
    const i3 = createInvoice(f.at(f.a), f.projectId, { type: "final", issueDate: "2027-04-02", dueDate: "2027-04-20", amountExGst: 3_000_000 });
    expect(issueInvoice(f.at(f.a), i1.invoiceId).number).toBe("INV/26-27/001");
    expect(issueInvoice(f.at(f.a), i3.invoiceId).number).toBe("INV/27-28/001");
    expect(issueInvoice(f.at(f.a), draft.invoiceId).number).toBe("INV/26-27/002");
    const inv = f.db.select().from(invoices).where(eq(invoices.id, i1.invoiceId)).get();
    expect(inv).toMatchObject({ cgst: 270_000, sgst: 270_000, igst: 0, total: 3_540_000, status: "sent" });
  });

  it("charges IGST when the place of supply is another state", () => {
    const f = bootstrap({ newClient: { businessName: "Mumbai Cafe", stateCode: "27" } });
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 1_000_000 });
    expect(f.db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()).toMatchObject({ cgst: 0, sgst: 0, igst: 180_000 });
  });

  it("sets the MSME due date when the studio is Udyam-registered", () => {
    const f = bootstrap();
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "final", issueDate: "2026-10-01", dueDate: "2026-12-31", amountExGst: 1_000_000 });
    issueInvoice(f.at(f.a), invoiceId);
    expect(f.db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()?.msmeDueDate).toBe("2026-11-15");
  });
});

describe("payments", () => {
  function issued(f: ReturnType<typeof bootstrap>) {
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 10_000_000, tdsExpectedRateBp: 1000 });
    issueInvoice(f.at(f.a), invoiceId);
    return invoiceId;
  }

  it("payment needs other partner verification to count", () => {
    const f = bootstrap();
    const invoiceId = issued(f);
    const { paymentId } = recordPayment(f.at(f.a), invoiceId, { receivedDate: "2026-10-05", amountReceived: 10_800_000, tdsDeducted: 1_000_000, bankReference: "UTR998", mode: "bank" });
    expect(liveContribution(f.db, f.projectId).result.revenuePaise).toBe(0);
    expect(() => verifyPayment(f.at(f.a), paymentId)).toThrow(/other partner/);
    verifyPayment(f.at(f.b), paymentId);
    expect(liveContribution(f.db, f.projectId).result.revenuePaise).toBe(9_000_000);
    expect(f.db.select().from(payments).where(eq(payments.id, paymentId)).get()).toMatchObject({ gstComponent: 1_800_000, revenueExGst: 9_000_000, tdsCertificateStatus: "pending" });
    expect(f.db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()?.status).toBe("paid");
    expect(financeSummary(f.db, f.projectId).tdsReceivable).toBe(1_000_000);
  });

  it("refuses overpayment", () => {
    const f = bootstrap();
    const invoiceId = issued(f);
    expect(() => recordPayment(f.at(f.a), invoiceId, { receivedDate: "2026-10-05", amountReceived: 12_000_000, tdsDeducted: 0, bankReference: "UTR1", mode: "bank" })).toThrow(/more than/);
  });

  it("part payment then write-off settles the invoice", () => {
    const f = bootstrap();
    const invoiceId = issued(f);
    recordPayment(f.at(f.a), invoiceId, { receivedDate: "2026-10-05", amountReceived: 5_000_000, tdsDeducted: 0, bankReference: "UTR2", mode: "upi" });
    expect(f.db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()?.status).toBe("part_paid");
    writeOffInvoice(f.at(f.b), invoiceId, "Client closed business; balance uncollectable");
    expect(financeSummary(f.db, f.projectId).unsettledInvoices).toBe(0);
  });
});

describe("expenses", () => {
  it("are approved by the partner who did not pay", () => {
    const f = bootstrap();
    const { expenseId } = addExpense(f.at(f.b), { projectId: f.projectId, expenseDate: "2026-10-02", vendor: "Envato", description: "Stock photos", amount: 250_000, paidByMemberId: f.b, reimbursable: true });
    expect(() => approveExpense(f.at(f.b), expenseId)).toThrow(/other partner/);
    approveExpense(f.at(f.a), expenseId);
    expect(liveContribution(f.db, f.projectId).result.expensesPaise).toBe(250_000);
  });
});

describe("issued invoices are frozen", () => {
  it("stores seller and buyer details at issue and keeps them after the client changes", async () => {
    const { updateClient } = await import("@/server/projects");
    const { clients, invoices, projects } = await import("@/db/schema");
    const f = bootstrap();
    const clientId = f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()!.clientId!;
    updateClient(f.at(f.a), clientId, { businessName: "Sunrise Bakery", stateCode: "36", gstin: "36AAACS1234A1Z5", contactName: "Ravi", contactEmail: "ravi@example.com", contactPhone: "9876543210", address: "Road No. 1, Hyderabad" });
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 3_000_000 });
    issueInvoice(f.at(f.a), invoiceId);
    updateClient(f.at(f.a), clientId, { businessName: "Sunrise Bakers Pvt Ltd", stateCode: "36", gstin: "", contactName: "Ravi", contactEmail: "", contactPhone: "", address: "New address" });
    const inv = f.db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()!;
    expect(inv.parties?.recipient).toMatchObject({ name: "Sunrise Bakery", gstin: "36AAACS1234A1Z5", address: "Road No. 1, Hyderabad" });
    expect(inv.parties?.placeOfSupply).toBe("36");
    expect(f.db.select().from(clients).where(eq(clients.id, clientId)).get()?.businessName).toBe("Sunrise Bakers Pvt Ltd");
    expect(() => f.db.update(invoices).set({ amountExGst: 1 }).where(eq(invoices.id, invoiceId)).run()).toThrow(/issued invoice cannot be changed/);
    expect(() => f.db.delete(invoices).where(eq(invoices.id, invoiceId)).run()).toThrow(/cannot be deleted/);
  });

  it("validates client GSTIN against the state", async () => {
    const { updateClient } = await import("@/server/projects");
    const { projects } = await import("@/db/schema");
    const f = bootstrap();
    const clientId = f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()!.clientId!;
    const base = { businessName: "Sunrise Bakery", stateCode: "36", contactName: "", contactEmail: "", contactPhone: "", address: "" };
    expect(() => updateClient(f.at(f.a), clientId, { ...base, gstin: "29AAACS1234A1Z5" })).toThrow(/match the client's state/);
    expect(() => updateClient(f.at(f.a), clientId, { ...base, gstin: "123" })).toThrow(/15 characters/);
    expect(() => updateClient(f.at(f.a), clientId, { ...base, gstin: "", contactEmail: "not-an-email" })).toThrow(/valid email/);
  });
});

describe("copy an invoice", () => {
  it("starts a new draft dated today with the same amount and payment terms", async () => {
    const { duplicateInvoice } = await import("@/server/finance");
    const f = bootstrap();
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "milestone", issueDate: "2026-09-01", dueDate: "2026-09-16", amountExGst: 1_200_000, tdsExpectedRateBp: 200, notes: "Monthly care plan" });
    issueInvoice(f.at(f.a), invoiceId);
    const { invoiceId: copy } = duplicateInvoice(f.at(f.a, new Date("2026-10-01T06:00:00Z")), invoiceId);
    const inv = f.db.select().from(invoices).where(eq(invoices.id, copy)).get()!;
    expect(inv).toMatchObject({ status: "draft", number: null, issueDate: "2026-10-01", dueDate: "2026-10-16", amountExGst: 1_200_000, tdsExpectedRateBp: 200, notes: "Monthly care plan" });
  });
});
