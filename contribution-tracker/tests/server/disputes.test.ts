import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { retroItems, taskContributions } from "@/db/schema";
import { liveContribution } from "@/server/contribution";
import { acceptResolution, escalateDispute, proposeResolution, raiseDispute } from "@/server/disputes";
import { runDueJobs } from "@/server/jobs";
import { bootstrap, completeTask } from "../fixtures";
import { T0 } from "../helpers";

const days = (d: number) => new Date(T0.getTime() + d * 86_400_000);

function memberPoints(f: ReturnType<typeof bootstrap>, id: number) {
  return liveContribution(f.db, f.projectId).result.members.find((m) => m.memberId === String(id))?.totalPoints ?? 0;
}

describe("disputes", () => {
  it("open dispute holds points", () => {
    const f = bootstrap({ originatedBy: null });
    const t = completeTask(f, "D-02"); // Bala's 3-point discovery meeting
    const before = memberPoints(f, f.b);
    const { disputeId } = raiseDispute(f.at(f.a), { projectId: f.projectId, targetType: "task_instance", targetId: t.id, reasonCode: "wrong_owner_share", description: "I ran half of this meeting" });
    expect(memberPoints(f, f.b)).toBe(before - 3);
    proposeResolution(f.at(f.b), disputeId, { resolution: "change_shares", payload: { sharesBp: { [f.a]: 5000, [f.b]: 5000 } } });
    acceptResolution(f.at(f.a), disputeId);
    expect(memberPoints(f, f.b)).toBe(before - 1.5);
  });

  it("default 50/50 after 14 days", () => {
    const f = bootstrap();
    const t = completeTask(f, "D-02");
    raiseDispute(f.at(f.a), { projectId: f.projectId, targetType: "task_instance", targetId: t.id, reasonCode: "wrong_owner_share", description: "Shared work" });
    expect(runDueJobs(f.at(null, days(13))).disputesDefaulted).toBe(0);
    expect(runDueJobs(f.at(null, days(15))).disputesDefaulted).toBe(1);
    const shares = f.db.select().from(taskContributions).where(eq(taskContributions.taskInstanceId, t.id)).all();
    expect(Object.fromEntries(shares.map((s) => [s.memberId, s.shareBp]))).toEqual({ [f.a]: 5000, [f.b]: 5000 });
  });

  it("escalated dispute does not default", () => {
    const f = bootstrap();
    const t = completeTask(f, "D-02");
    const { disputeId } = raiseDispute(f.at(f.a), { projectId: f.projectId, targetType: "task_instance", targetId: t.id, reasonCode: "not_done", description: "Meeting never happened" });
    escalateDispute(f.at(f.b), disputeId, "Taking this to our CA as the deed says");
    expect(runDueJobs(f.at(null, days(30))).disputesDefaulted).toBe(0);
  });

  it("third dispute creates retro item", () => {
    const f = bootstrap();
    for (const code of ["D-01", "D-02", "D-03"]) {
      const t = completeTask(f, code);
      raiseDispute(f.at(f.a === t.verifiedBy ? f.a : f.b), { projectId: f.projectId, targetType: "task_instance", targetId: t.id, reasonCode: "points_inflated", description: `Dispute on ${code}` });
    }
    const items = f.db.select().from(retroItems).where(eq(retroItems.projectId, f.projectId)).all();
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("dispute_threshold");
  });

  it("cannot raise a dispute after the 7-day window", () => {
    const f = bootstrap();
    const t = completeTask(f, "D-02");
    expect(() =>
      raiseDispute(f.at(f.a, days(8)), { projectId: f.projectId, targetType: "task_instance", targetId: t.id, reasonCode: "not_done", description: "Too late" }),
    ).toThrow(/7 days/);
  });

  it("only one active dispute per item", () => {
    const f = bootstrap();
    const t = completeTask(f, "D-02");
    raiseDispute(f.at(f.a), { projectId: f.projectId, targetType: "task_instance", targetId: t.id, reasonCode: "not_done", description: "First" });
    expect(() => raiseDispute(f.at(f.a), { projectId: f.projectId, targetType: "task_instance", targetId: t.id, reasonCode: "other", description: "Second" })).toThrow(/already/);
  });
});
