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
