import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { contributionSnapshots, distributions, handoverItems, projects, reserveLedger, taskInstances } from "@/db/schema";
import {
  approvePostLockAdjustment,
  approveSnapshot,
  closureChecklist,
  computeSnapshot,
  requestPostLockAdjustment,
  reverifySnapshot,
  setClosureItem,
  startClosing,
} from "@/server/closure";
import { addEvidence } from "@/server/evidence";
import { addExpense, approveExpense, createInvoice, issueInvoice, recordPayment, verifyPayment } from "@/server/finance";
import { updateHandoverItem } from "@/server/handover";
import { proposeCustomTask, updatePlannedTask } from "@/server/plan";
import { bootstrap, completeTask, type Fixture } from "../fixtures";

/** A custom project reproducing the spec's worked example from real rows. */
function workedExample(): Fixture {
  const f = bootstrap({ projectType: "custom", originatedBy: null });
  proposeCustomTask(f.at(f.a), f.projectId, { name: "Build all pages", categoryCode: "V", defaultPoints: 130, ownerMemberId: f.a });
  proposeCustomTask(f.at(f.b), f.projectId, { name: "UI design", categoryCode: "S", defaultPoints: 90, ownerMemberId: f.b });
  completeTask(f, "V-X01");
  completeTask(f, "S-X01");
  const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "final", issueDate: "2026-10-01", dueDate: "2026-10-15", amountExGst: 6_000_000 });
  issueInvoice(f.at(f.a), invoiceId);
  const { paymentId } = recordPayment(f.at(f.a), invoiceId, { receivedDate: "2026-10-05", amountReceived: 7_080_000, tdsDeducted: 0, bankReference: "UTR123", mode: "bank" });
  verifyPayment(f.at(f.b), paymentId);
  const { expenseId } = addExpense(f.at(f.b), { projectId: f.projectId, expenseDate: "2026-10-02", vendor: "ThemeForest", description: "Theme and stock photos", amount: 600_000, paidByMemberId: f.b, reimbursable: true });
  approveExpense(f.at(f.a), expenseId);
  for (const item of f.db.select().from(handoverItems).where(eq(handoverItems.projectId, f.projectId)).all()) {
    updateHandoverItem(f.at(f.a), item.id, { status: "not_applicable" });
  }
  return f;
}

function closeAndLock(f: Fixture) {
  startClosing(f.at(f.a), f.projectId);
  setClosureItem(f.at(f.a), f.projectId, 6, { done: true, note: "Retro held on call" });
  const snap = computeSnapshot(f.at(f.a), f.projectId);
  approveSnapshot(f.at(f.b), snap.snapshotId);
  return snap;
}

describe("closure", () => {
  it("end-to-end worked example from DB rows gives 27,835 / 26,765", () => {
    const f = workedExample();
    closeAndLock(f);
    const rows = f.db.select().from(distributions).where(eq(distributions.projectId, f.projectId)).all();
    expect(rows.find((r) => r.memberId === f.a)?.total).toBe(2_783_500);
    expect(rows.find((r) => r.memberId === f.b)?.total).toBe(2_676_500);
    expect(rows.find((r) => r.memberId === f.b)?.reimbursement).toBe(600_000);
    expect(f.db.select().from(reserveLedger).get()).toMatchObject({ direction: "in", amount: 540_000, status: "approved" });
    expect(f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()?.closeStatus).toBe("closed_locked");
    expect(f.db.select().from(taskInstances).where(eq(taskInstances.projectId, f.projectId)).all().every((t) => t.status === "locked")).toBe(true);
  });

  it("snapshot needs both partners and starts with the creator's approval", () => {
    const f = workedExample();
    startClosing(f.at(f.a), f.projectId);
    setClosureItem(f.at(f.a), f.projectId, 6, { done: true, note: "Retro" });
    const snap = computeSnapshot(f.at(f.a), f.projectId);
    expect(() => approveSnapshot(f.at(f.a), snap.snapshotId)).toThrow(/already approved/);
    expect(f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()?.closeStatus).toBe("awaiting_partner");
  });

  it("cannot snapshot while tasks are still open", () => {
    const f = bootstrap();
    startClosing(f.at(f.a), f.projectId);
    expect(() => computeSnapshot(f.at(f.a), f.projectId)).toThrow(/verified or cancelled/);
    const list = closureChecklist(f.db, f.projectId);
    expect(list[0]?.done).toBe(false);
  });

  it("editing a locked project fails", () => {
    const f = workedExample();
    closeAndLock(f);
    const task = f.db.select().from(taskInstances).where(eq(taskInstances.projectId, f.projectId)).get();
    expect(() => updatePlannedTask(f.at(f.a), task?.id ?? 0, { notes: "x" })).toThrow(/locked/);
    expect(() =>
      addEvidence(f.at(f.a), { subjectType: "task", subjectId: task?.id ?? 0, type: "git_commit", externalRef: "abc", description: "Late evidence after lock", containsPersonalData: false, redacted: false, noSecretsConfirmed: true }),
    ).toThrow(/locked/);
    expect(() => createInvoice(f.at(f.a), f.projectId, { type: "final", issueDate: "2026-10-10", dueDate: "2026-10-20", amountExGst: 100 })).toThrow(/locked/);
  });

  it("post-lock adjustment needs both approvals", () => {
    const f = workedExample();
    closeAndLock(f);
    const { adjustmentId } = requestPostLockAdjustment(f.at(f.a), f.projectId, {
      reason: "Late retention payment received",
      revenueDeltaPaise: 1_000_000,
      expenses: [],
      points: [],
    });
    expect(() => approvePostLockAdjustment(f.at(f.a), adjustmentId)).toThrow(/already approved/);
    expect(f.db.select().from(contributionSnapshots).where(eq(contributionSnapshots.projectId, f.projectId)).all()).toHaveLength(1);
    const r = approvePostLockAdjustment(f.at(f.b), adjustmentId);
    expect(r.applied).toBe(true);
    const snaps = f.db.select().from(contributionSnapshots).where(eq(contributionSnapshots.projectId, f.projectId)).all();
    expect(snaps).toHaveLength(2);
    expect(snaps[1]).toMatchObject({ kind: "adjustment", status: "locked", seq: 2 });
    const delta = f.db.select().from(distributions).where(eq(distributions.snapshotId, r.snapshotId ?? 0)).all();
    // ₹10,000 more revenue: reserve ₹1,000, base ₹900 each, pool ₹7,200 split 130:90.
    expect(delta.reduce((s, d) => s + d.total, 0)).toBe(900_000);
  });

  it("snapshot hash re-verifies", () => {
    const f = workedExample();
    const snap = closeAndLock(f);
    expect(reverifySnapshot(f.db, snap.snapshotId)).toMatchObject({ ok: true });
  });
});

describe("year summary", () => {
  it("adds up each partner's locked payouts and the studio's money for the financial year", async () => {
    const { yearSummary } = await import("@/server/yearSummary");
    const f = workedExample();
    closeAndLock(f);
    const y = yearSummary(f.db, "26-27");
    const a = y.partners.find((p) => p.memberId === f.a)!;
    const b = y.partners.find((p) => p.memberId === f.b)!;
    expect(a.total).toBe(2_783_500);
    expect(b.total).toBe(2_676_500);
    expect(b.reimbursement).toBe(600_000);
    expect(a.due + b.due).toBe(2_783_500 + 2_676_500);
    expect(a.projects).toBe(1);
    expect(y.studio).toMatchObject({ invoicedExGst: 6_000_000, cashReceived: 7_080_000, revenueExGst: 6_000_000, expenses: 600_000, reserveIn: 540_000 });
    expect(yearSummary(f.db, "25-26").partners.every((p) => p.total === 0)).toBe(true);
  });
});
