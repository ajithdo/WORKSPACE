import { describe, expect, it } from "vitest";
import { gstinCheckChar, gstinProblem } from "@/domain/gstin";

describe("GSTIN", () => {
  it("accepts a real-format GSTIN with the right check character", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(gstinProblem("27AAPFU0939F1ZV", "27")).toBeNull();
    expect(gstinProblem("36aaacs1234a1z3")).toBeNull();
  });
  it("catches typos, bad formats and the wrong state", () => {
    expect(gstinProblem("27AAPFU0939F1ZW")).toMatch(/typo/);
    expect(gstinProblem("27AAPFU0939F1Z")).toMatch(/15 characters/);
    expect(gstinProblem("27AAPFU0939F1ZV", "36")).toMatch(/state/);
  });
});
