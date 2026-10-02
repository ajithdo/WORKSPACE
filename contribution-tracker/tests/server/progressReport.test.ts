import { describe, expect, it } from "vitest";
import { createInvoice, issueInvoice } from "@/server/finance";
import { progressReport, progressText } from "@/server/progressReport";
import { startTask } from "@/server/tasks";
import { bootstrap, completeTask, contributorsOf, openGate1, taskByCode } from "../fixtures";

describe("client progress report", () => {
  it("lists finished work, work in progress and what waits on the client, without internal tasks", () => {
    const f = bootstrap();
    completeTask(f, "A-03"); // pre-sales: internal, never shown
    openGate1(f);
    const design = taskByCode(f, "S-01");
    startTask(f.at(contributorsOf(f, design.id)[0]!), design.id);
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 3_000_000 });
    issueInvoice(f.at(f.a), invoiceId);

    const r = progressReport(f.db, f.projectId, "2026-09-25", "2026-10-02");
    expect(r.done.map((d) => d.code)).toEqual(expect.arrayContaining(["H-05", "I-02"]));
    expect(r.done.map((d) => d.code)).not.toContain("A-03");
    expect(r.inProgress.map((t) => t.code)).toContain("S-01");
    expect(r.waitingOnClient.join(" ")).toContain("INV/26-27/001");
    expect(r.milestones.find((m) => m.code === "M2")?.done).toBe(true);

    const text = progressText(r, "Two Partner Studio");
    expect(text).toContain("*Completed*");
    expect(text).toContain("*Waiting on you*");
    expect(progressReport(f.db, f.projectId, "2026-11-01", "2026-11-07").done).toEqual([]);
  });
});

describe("client approvals in the update", () => {
  it("only lists approvals for finished deliverables", async () => {
    const { clientApprovals } = await import("@/db/schema");
    const f = bootstrap();
    const rows = f.db.select().from(clientApprovals).all();
    const r = progressReport(f.db, f.projectId, "2026-09-25", "2026-10-02");
    expect(r.waitingOnClient.filter((w) => w.startsWith("Your approval")).length).toBeLessThanOrEqual(rows.filter((a) => a.requestedAt).length);
  });
});
