import { describe, expect, it } from "vitest";
import seedConfig from "../../seed/seed_config.json";
import { parseStudioConfig, withAppDefaults } from "@/domain/config";

describe("studio config", () => {
  it("parses the seed config and fills added defaults", () => {
    const cfg = parseStudioConfig(seedConfig);
    expect(cfg.calculation.reserve_pct).toBe(0.1);
    expect(cfg.calculation.effort_adjustment_trigger_multiple).toBe(2);
    expect(cfg.calculation.dispute_default_split_mode).toBe("share_between_parties");
    expect(cfg.calculation.msme_payment_days).toBe(45);
    expect(cfg.categories).toHaveLength(67);
    expect(cfg.communication_types.find((c) => c.code === "discovery_call")?.lead_points).toBe(3);
  });

  it("rejects base and pool percentages that do not add up to 100%", () => {
    const bad = structuredClone(seedConfig) as typeof seedConfig;
    bad.calculation.pool_pct = 0.7;
    expect(() => parseStudioConfig(bad)).toThrow(/base_share_pct \+ pool_pct/);
  });

  it("rejects caps of 100% or more", () => {
    const bad = structuredClone(seedConfig) as typeof seedConfig;
    bad.calculation.communication_cap_pct = 1;
    expect(() => parseStudioConfig(bad)).toThrow();
  });

  it("adds descoping from in_progress and blocked (decision D11)", () => {
    const cfg = withAppDefaults(parseStudioConfig(seedConfig));
    expect(cfg.task_transitions).toContainEqual(["in_progress", "cancelled"]);
    expect(cfg.task_transitions).toContainEqual(["blocked", "cancelled"]);
    expect(withAppDefaults(cfg).task_transitions.length).toBe(cfg.task_transitions.length);
  });
});
