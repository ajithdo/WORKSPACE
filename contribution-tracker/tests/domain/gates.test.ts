import { describe, expect, it } from "vitest";
import seedConfig from "../../seed/seed_config.json";
import { parseStudioConfig } from "@/domain/config";
import { evaluateMilestones, gateBlockFor, type GateTaskState } from "@/domain/gates";

const cfg = parseStudioConfig(seedConfig);
const ms = cfg.milestones;

function t(code: string, status: GateTaskState["status"], clientApproval: GateTaskState["clientApproval"] = "No", approval: GateTaskState["clientApprovalStatus"] = null, at = "2026-10-01T10:00:00.000Z"): GateTaskState {
  return { code, status, clientApproval, clientApprovalStatus: approval, doneAt: at };
}

const baseTasks = [t("H-05", "planned", "Yes"), t("I-02", "planned"), t("U-04", "planned", "Yes"), t("BA-02", "planned", "Yes"), t("BF-02", "planned"), t("J-07", "planned"), t("J-08", "planned")];

describe("hard gates", () => {
  it("gate 1 blocks design before H-05+I-02", () => {
    const states = evaluateMilestones(ms, baseTasks, {});
    expect(gateBlockFor({ code: "S-01", phase: "design", categoryCode: "S" }, ms, states)).toMatchObject({
      milestoneCode: "M2",
      missing: ["H-05", "I-02"],
    });
  });

  it("J-* setup is not blocked", () => {
    const states = evaluateMilestones(ms, baseTasks, {});
    expect(gateBlockFor({ code: "J-01", phase: "kickoff", categoryCode: "J" }, ms, states)).toBeNull();
  });

  it("gate 1 opens once the contract is verified and client-approved and the advance is verified", () => {
    const tasks = baseTasks.map((x) => (x.code === "H-05" ? t("H-05", "verified", "Yes", "approved") : x.code === "I-02" ? t("I-02", "verified") : x));
    const states = evaluateMilestones(ms, tasks, {});
    expect(gateBlockFor({ code: "S-01", phase: "design", categoryCode: "S" }, ms, states)).toBeNull();
  });

  it("a verified gate task still waits for client approval", () => {
    const tasks = baseTasks.map((x) => (x.code === "H-05" ? t("H-05", "verified", "Yes", "pending") : x.code === "I-02" ? t("I-02", "verified") : x));
    const states = evaluateMilestones(ms, tasks, {});
    expect(gateBlockFor({ code: "S-01", phase: "design", categoryCode: "S" }, ms, states)?.missing).toEqual(["H-05"]);
  });

  it("gate 2 blocks page builds, gate 4 blocks ownership transfer", () => {
    const states = evaluateMilestones(ms, baseTasks, {});
    expect(gateBlockFor({ code: "V-11", phase: "development", categoryCode: "V" }, ms, states)?.milestoneCode).toBe("M2");
    const gate1Open = baseTasks.map((x) => (x.code === "H-05" ? t("H-05", "verified", "Yes", "approved") : x.code === "I-02" ? t("I-02", "locked") : x));
    const states2 = evaluateMilestones(ms, gate1Open, {});
    expect(gateBlockFor({ code: "V-11", phase: "development", categoryCode: "V" }, ms, states2)?.milestoneCode).toBe("M5");
    expect(gateBlockFor({ code: "V-10", phase: "development", categoryCode: "V" }, ms, states2)).toBeNull();
    expect(gateBlockFor({ code: "BG-03", phase: "handover", categoryCode: "BG" }, ms, states2)?.milestoneCode).toBe("M9");
    expect(gateBlockFor({ code: "BA-03", phase: "launch", categoryCode: "BA" }, ms, states2)?.milestoneCode).toBe("M7");
  });

  it("descoped gate task shows waived", () => {
    const tasks = [...baseTasks.filter((x) => x.code !== "U-04"), t("U-04", "cancelled", "Yes")];
    const states = evaluateMilestones(ms, tasks, {});
    expect(states.find((s) => s.code === "M5")?.state).toBe("waived");
  });

  it("a gate whose tasks are not in the plan is waived", () => {
    const states = evaluateMilestones(ms, [], {});
    expect(states.find((s) => s.code === "M7")?.state).toBe("waived");
  });
});

describe("milestones", () => {
  it("extra conditions keep a milestone pending (M3 needs the plan locked)", () => {
    const tasks = [t("J-07", "verified"), t("J-08", "verified")];
    const pending = evaluateMilestones(ms, tasks, { M3: { ok: false, label: "Plan locked" } });
    expect(pending.find((s) => s.code === "M3")).toMatchObject({ state: "pending", missing: ["Plan locked"] });
    const done = evaluateMilestones(ms, tasks, { M3: { ok: true, label: "Plan locked" } });
    expect(done.find((s) => s.code === "M3")?.state).toBe("complete");
  });

  it("records when a milestone was achieved", () => {
    const tasks = [t("J-07", "verified", "No", null, "2026-10-01T10:00:00.000Z"), t("J-08", "verified", "No", null, "2026-10-03T09:00:00.000Z")];
    const s = evaluateMilestones(ms, tasks, {}).find((x) => x.code === "M3");
    expect(s?.achievedAt).toBe("2026-10-03T09:00:00.000Z");
  });
});
