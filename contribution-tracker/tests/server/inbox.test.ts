import { describe, expect, it } from "vitest";
import { inboxFor } from "@/server/inbox";
import { submitPlan } from "@/server/plan";
import { startTask, submitTask } from "@/server/tasks";
import { bootstrap, strongEvidence, taskByCode } from "../fixtures";
import { T0 } from "../helpers";

describe("inbox", () => {
  it("lists submissions and plans waiting on me, not on the person who sent them", () => {
    const f = bootstrap();
    const t = taskByCode(f, "D-02");
    startTask(f.at(f.b), t.id);
    strongEvidence(f, f.b, t.id);
    submitTask(f.at(f.b), t.id);
    submitPlan(f.at(f.b), f.projectId);
    const mine = inboxFor(f.db, f.a, T0).map((i) => i.kind);
    expect(mine).toContain("verify_task");
    expect(mine).toContain("approve_plan");
    const theirs = inboxFor(f.db, f.b, T0).map((i) => i.kind);
    expect(theirs).not.toContain("verify_task");
    expect(theirs).not.toContain("approve_plan");
  });
});

describe("studio setup reminder", () => {
  it("asks for the details invoices need, then goes away", async () => {
    const { updateStudio } = await import("@/server/settings");
    const f = bootstrap();
    const item = inboxFor(f.db, f.a, T0).find((i) => i.kind === "setup_studio");
    expect(item?.detail).toMatch(/legal name, address, GSTIN, Udyam number/);
    updateStudio(f.at(f.a), { legalName: "Two Partner Studio LLP", address: "Hyderabad", gstin: "36ABCDE1234F1Z5", udyamNumber: "UDYAM-TS-00-0000001" });
    expect(inboxFor(f.db, f.a, T0).some((i) => i.kind === "setup_studio")).toBe(false);
  });
});

describe("TDS certificate follow-up", () => {
  it("appears 60 days after a payment with TDS until the certificate is recorded", async () => {
    const { createInvoice, issueInvoice, recordPayment, recordTdsCertificate } = await import("@/server/finance");
    const f = bootstrap();
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 3_000_000, tdsExpectedRateBp: 1000 });
    issueInvoice(f.at(f.a), invoiceId);
    const { paymentId } = recordPayment(f.at(f.a), invoiceId, { receivedDate: "2026-10-01", amountReceived: 3_240_000, tdsDeducted: 300_000, bankReference: "UTR42", mode: "bank" });
    const tds = (d: string) => inboxFor(f.db, f.a, new Date(d)).filter((i) => i.kind === "tds_certificate");
    expect(tds("2026-11-15T00:00:00Z")).toHaveLength(0);
    expect(tds("2026-12-01T00:00:00Z")).toHaveLength(1);
    recordTdsCertificate(f.at(f.a), paymentId, {});
    expect(tds("2026-12-01T00:00:00Z")).toHaveLength(0);
  });
});
