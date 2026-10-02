import { describe, expect, it } from "vitest";
import { myWork } from "@/server/myWork";
import { startTask, submitTask, rejectSubmission } from "@/server/tasks";
import { bootstrap, contributorsOf, openGate1, strongEvidence, taskByCode } from "../fixtures";

describe("my work", () => {
  it("groups a partner's own tasks by what to do next", () => {
    const f = bootstrap();
    const before = myWork(f.db, f.a);
    // Before the contract and advance, design work waits on gate 1.
    expect(before.waitingOnGate.length).toBeGreaterThan(0);
    expect(before.waitingOnGate[0]?.note).toMatch(/waiting on/);
    openGate1(f);
    const s01 = taskByCode(f, "S-01");
    const owner = contributorsOf(f, s01.id)[0]!;
    const other = owner === f.a ? f.b : f.a;
    startTask(f.at(owner), s01.id);
    strongEvidence(f, owner, s01.id);
    submitTask(f.at(owner), s01.id);
    rejectSubmission(f.at(other), s01.id, "The moodboard link is private");
    const w = myWork(f.db, owner);
    expect(w.sentBack.map((t) => t.code)).toContain("S-01");
    expect(w.sentBack.find((t) => t.code === "S-01")?.note).toMatch(/private/);
    expect(w.ready.length).toBeGreaterThan(0);
    // Other people's tasks never appear.
    expect(myWork(f.db, other).sentBack.map((t) => t.code)).not.toContain("S-01");
  });
});
