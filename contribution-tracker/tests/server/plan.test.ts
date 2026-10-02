import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { handoverItems, projects, taskInstances } from "@/db/schema";
import { approvePlan, rejectPlan, submitPlan, updatePlannedTask } from "@/server/plan";
import { bootstrap, contributorsOf, taskByCode } from "../fixtures";

describe("project creation", () => {
  it("seeds a brochure plan with 225 tasks, owners and exact shares", () => {
    const f = bootstrap();
    const tasks = f.db.select().from(taskInstances).where(eq(taskInstances.projectId, f.projectId)).all();
    expect(tasks).toHaveLength(225);
    expect(tasks.every((t) => t.status === "planned" && t.ownerMemberId !== null)).toBe(true);
    expect(contributorsOf(f, taskByCode(f, "V-09").id)).toEqual([f.a]);
    expect(contributorsOf(f, taskByCode(f, "W-02").id)).toEqual([f.b]);
    expect(contributorsOf(f, taskByCode(f, "J-08").id).sort()).toEqual([f.a, f.b].sort());
  });

  it("creates the 34-item handover checklist for client projects", () => {
    const f = bootstrap();
    expect(f.db.select().from(handoverItems).where(eq(handoverItems.projectId, f.projectId)).all()).toHaveLength(34);
  });
});

describe("plan lock", () => {
  it("needs both partners", () => {
    const f = bootstrap();
    submitPlan(f.at(f.a), f.projectId);
    expect(f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()?.planStatus).toBe("awaiting_partner");
    expect(() => approvePlan(f.at(f.a), f.projectId)).toThrow(/already approved/);
    approvePlan(f.at(f.b), f.projectId);
    expect(f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()?.planStatus).toBe("locked");
  });

  it("rejection sends the plan back to draft with a reason", () => {
    const f = bootstrap();
    submitPlan(f.at(f.a), f.projectId);
    rejectPlan(f.at(f.b), f.projectId, "V-11 quantity should be 6 pages");
    const p = f.db.select().from(projects).where(eq(projects.id, f.projectId)).get();
    expect(p?.planStatus).toBe("draft");
    expect(p?.planRound).toBe(2);
  });

  it("locked plan cannot be edited directly", () => {
    const f = bootstrap();
    submitPlan(f.at(f.a), f.projectId);
    approvePlan(f.at(f.b), f.projectId);
    expect(() => updatePlannedTask(f.at(f.a), taskByCode(f, "V-11").id, { quantity: 6 })).toThrow(/plan is locked/);
  });

  it("draft edits validate shares and factor bounds", () => {
    const f = bootstrap();
    const t = taskByCode(f, "V-11");
    expect(() => updatePlannedTask(f.at(f.a), t.id, { sharesBp: { [f.a]: 6000, [f.b]: 5000 } })).toThrow(/100%/);
    expect(() => updatePlannedTask(f.at(f.a), t.id, { adjustmentFactor: 1.6 })).toThrow(/between/);
    updatePlannedTask(f.at(f.a), t.id, { quantity: 6, sharesBp: { [f.a]: 7000, [f.b]: 3000 } });
    expect(taskByCode(f, "V-11").quantity).toBe(6);
  });
});
