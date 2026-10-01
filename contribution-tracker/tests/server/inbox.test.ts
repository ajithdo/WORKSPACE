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
