import { describe, expect, it } from "vitest";
import seedConfig from "../../seed/seed_config.json";
import { parseStudioConfig, withAppDefaults } from "@/domain/config";
import {
  adjustmentFactorAllowed,
  assertTransition,
  effortTriggerMet,
  evidenceCheck,
  plannedPoints,
  sharesValid,
  verifierEligibility,
} from "@/domain/taskRules";

const cfg = withAppDefaults(parseStudioConfig(seedConfig));
const rule = cfg.calculation.evidence_rule;

describe("task transitions", () => {
  it("allows configured transitions", () => {
    expect(() => assertTransition("planned", "in_progress", cfg.task_transitions)).not.toThrow();
    expect(() => assertTransition("submitted", "in_progress", cfg.task_transitions)).not.toThrow();
  });
  it("illegal transition throws", () => {
    expect(() => assertTransition("planned", "verified", cfg.task_transitions)).toThrow(/planned → verified/);
    expect(() => assertTransition("locked", "in_progress", cfg.task_transitions)).toThrow();
  });
});

describe("evidence rule", () => {
  it(">3 points needs strong", () => {
    expect(evidenceCheck(4, [{ strength: "medium" }], rule).ok).toBe(false);
    expect(evidenceCheck(4, [{ strength: "medium" }], rule).reason).toMatch(/strong/);
    expect(evidenceCheck(4, [{ strength: "weak" }, { strength: "strong" }], rule).ok).toBe(true);
  });
  it("1–3 points needs medium or strong", () => {
    expect(evidenceCheck(2, [{ strength: "weak" }], rule).ok).toBe(false);
    expect(evidenceCheck(2, [{ strength: "medium" }], rule).ok).toBe(true);
    expect(evidenceCheck(3, [{ strength: "strong" }], rule).ok).toBe(true);
  });
  it("no evidence never passes", () => {
    expect(evidenceCheck(1, [], rule).ok).toBe(false);
    expect(evidenceCheck(0, [], rule).ok).toBe(false);
  });
});

describe("verifier eligibility", () => {
  it("non-contributors verify", () => {
    expect(verifierEligibility([1, 2], [1], 1)).toEqual({ mode: "independent", eligible: [2] });
    expect(verifierEligibility([1, 2, 3], [1, 2], 1)).toEqual({ mode: "independent", eligible: [3] });
  });
  it("joint verification when every member contributed", () => {
    expect(verifierEligibility([1, 2], [1, 2], 1)).toEqual({ mode: "joint", eligible: [2] });
    expect(verifierEligibility([1, 2, 3], [1, 2, 3], 2)).toEqual({ mode: "joint", eligible: [1, 3] });
  });
});

describe("shares and points", () => {
  it("shares in basis points must sum to exactly 100%", () => {
    expect(sharesValid({ 1: 10000 })).toBe(true);
    expect(sharesValid({ 1: 5000, 2: 5000 })).toBe(true);
    expect(sharesValid({ 1: 6000, 2: 5000 })).toBe(false);
    expect(sharesValid({ 1: -1, 2: 10001 })).toBe(false);
    expect(sharesValid({ 1: 3333.5, 2: 6666.5 })).toBe(false);
    expect(sharesValid({})).toBe(false);
  });
  it("planned points = default × quantity × adjustment", () => {
    expect(plannedPoints(4, 2, 1.25)).toBe(10);
  });
  it("adjustment factor stays within configured bounds", () => {
    expect(adjustmentFactorAllowed(1.5, cfg.calculation)).toBe(true);
    expect(adjustmentFactorAllowed(0.5, cfg.calculation)).toBe(true);
    expect(adjustmentFactorAllowed(1.6, cfg.calculation)).toBe(false);
    expect(adjustmentFactorAllowed(0.4, cfg.calculation)).toBe(false);
  });
  it("effort trigger needs actual hours above 2× the estimate", () => {
    expect(effortTriggerMet(7, 3, 2)).toBe(true);
    expect(effortTriggerMet(6, 3, 2)).toBe(false);
    expect(effortTriggerMet(1, null, 2)).toBe(true);
  });
});
