import { describe, expect, it } from "vitest";
import seedConfig from "../../seed/seed_config.json";
import { calculateContribution, type CalcInput, type CalcTask } from "@/domain/calc";
import { parseStudioConfig } from "@/domain/config";

const params = parseStudioConfig(seedConfig).calculation;

function task(ref: string, points: number, shares: Record<string, number>, extra: Partial<CalcTask> = {}): CalcTask {
  return { ref, isCommunication: false, isSales: false, points, quantity: 1, adjustment: 1, ownDefect: false, shares, ...extra };
}

function input(partial: Partial<CalcInput>): CalcInput {
  return { members: ["A", "B"], tasks: [], communicationAwards: [], origination: null, revenuePaise: 0, expenses: [], ...partial };
}

const member = (r: ReturnType<typeof calculateContribution>, id: string) => {
  const m = r.members.find((x) => x.memberId === id);
  if (!m) throw new Error(`no member ${id}`);
  return m;
};

describe("calculateContribution — spec acceptance tests", () => {
  it("worked example: ₹60,000 revenue, ₹6,000 paid by B → A ₹27,835, B ₹26,765", () => {
    const r = calculateContribution(
      input({
        tasks: [task("V", 130, { A: 1 }), task("S", 90, { B: 1 })],
        revenuePaise: 6_000_000,
        expenses: [{ ref: "e1", amountPaise: 600_000, paidBy: "B", reimbursable: true }],
      }),
      params,
    );
    expect(member(r, "A").payoutPaise).toBe(2_783_500);
    expect(member(r, "B").payoutPaise).toBe(2_676_500);
    expect(member(r, "B").reimbursementPaidPaise).toBe(600_000);
    expect(r.reservePaise).toBe(540_000);
    expect(r.distributablePaise).toBe(4_860_000);
    expect(r.payoutTotalPaise + r.reservePaise + r.studioRetainedPaise).toBe(6_000_000);
    expect(member(r, "A").equalSplitPaise).toBe(2_430_000);
    expect(member(r, "B").equalSplitPaise).toBe(3_030_000);
  });

  it("communication 30% scaled to exactly 20%", () => {
    const r = calculateContribution(input({ tasks: [task("V", 70, { A: 1 }), task("K", 30, { B: 1 }, { isCommunication: true })] }), params);
    expect(member(r, "B").totalPoints / r.totalPoints).toBeCloseTo(0.2, 12);
    expect(r.caps.communication.applied).toBe(true);
    expect(r.caps.communication.before).toBe(30);
    expect(r.caps.communication.after).toBeCloseTo(17.5, 12);
  });

  it("communication awards from meetings count toward the communication cap", () => {
    const r = calculateContribution(
      input({ tasks: [task("V", 70, { A: 1 })], communicationAwards: [{ ref: "c1", memberId: "B", points: 30 }] }),
      params,
    );
    expect(member(r, "B").points.comm).toBeCloseTo(17.5, 12);
  });
});

describe("calculateContribution — caps and rules", () => {
  it("sales cap includes origination credit", () => {
    const r = calculateContribution(
      input({
        tasks: [task("V", 90, { A: 1 }), task("C", 5, { B: 1 }, { isSales: true })],
        origination: { memberId: "B", plannedTotal: 200 },
      }),
      params,
    );
    expect(member(r, "B").rawPoints.sales).toBe(15);
    expect(member(r, "B").points.sales).toBeCloseTo(10, 12);
    expect(r.totalPoints).toBeCloseTo(100, 12);
  });

  it("micro cap per member scales 1-point tasks to 25% of that member's total", () => {
    const micro = Array.from({ length: 10 }, (_, i) => task(`m${i}`, 1, { A: 1 }));
    const r = calculateContribution(input({ tasks: [...micro, task("V", 20, { A: 1 }), task("W", 10, { B: 1 })] }), params);
    const a = member(r, "A");
    expect(a.points.micro / a.totalPoints).toBeCloseTo(0.25, 12);
    expect(r.caps.micro.A?.applied).toBe(true);
    expect(r.caps.micro.B?.applied).toBe(false);
  });

  it("a 1-point per-unit task stays micro whatever its quantity", () => {
    const r = calculateContribution(input({ tasks: [task("m", 1, { A: 1 }, { quantity: 10 }), task("V", 90, { A: 1 })] }), params);
    expect(member(r, "A").rawPoints.micro).toBe(10);
  });

  it("own defect earns 0", () => {
    const r = calculateContribution(input({ tasks: [task("fix", 5, { A: 1 }, { ownDefect: true }), task("V", 10, { A: 1 })] }), params);
    expect(member(r, "A").totalPoints).toBe(10);
  });

  it("dispute multiplier voids or halves points", () => {
    const r = calculateContribution(
      input({ tasks: [task("V", 10, { A: 1 }, { multiplier: 0 }), task("S", 10, { B: 1 }, { multiplier: 0.5 }), task("W", 5, { A: 1 })] }),
      params,
    );
    expect(member(r, "A").totalPoints).toBe(5);
    expect(member(r, "B").totalPoints).toBe(5);
  });

  it("applies quantity, adjustment and share", () => {
    const r = calculateContribution(input({ tasks: [task("V", 4, { A: 0.25, B: 0.75 }, { quantity: 2, adjustment: 1.25 })] }), params);
    expect(member(r, "A").totalPoints).toBeCloseTo(2.5, 12);
    expect(member(r, "B").totalPoints).toBeCloseTo(7.5, 12);
    expect(member(r, "A").adjustmentPoints).toBeCloseTo(0.5, 12);
  });

  it("rejects shares for a member who is not on the project", () => {
    expect(() => calculateContribution(input({ tasks: [task("V", 4, { Z: 1 })] }), params)).toThrow(/not a project member/);
  });

  it("rejects shares that do not add up to 100%", () => {
    expect(() => calculateContribution(input({ tasks: [task("V", 4, { A: 0.5, B: 0.4 })] }), params)).toThrow(/add up/);
  });
});

describe("calculateContribution — money edge cases", () => {
  it("loss: reimbursements pro rata, no reserve, shortfall reported", () => {
    const r = calculateContribution(
      input({
        tasks: [task("V", 10, { A: 1 }), task("S", 10, { B: 1 })],
        revenuePaise: 500_000,
        expenses: [
          { ref: "e1", amountPaise: 600_000, paidBy: "A", reimbursable: true },
          { ref: "e2", amountPaise: 200_000, paidBy: "B", reimbursable: true },
        ],
      }),
      params,
    );
    expect(r.reservePaise).toBe(0);
    expect(member(r, "A")).toMatchObject({ reimbursementPaidPaise: 375_000, shortfallPaise: 225_000, basePaise: 0, poolPaise: 0, payoutPaise: 375_000 });
    expect(member(r, "B")).toMatchObject({ reimbursementPaidPaise: 125_000, shortfallPaise: 75_000, payoutPaise: 125_000 });
    expect(r.notes).toContain("loss");
  });

  it("zero points splits pool equally", () => {
    const r = calculateContribution(input({ revenuePaise: 1_000_000 }), params);
    expect(member(r, "A").payoutPaise).toBe(450_000);
    expect(member(r, "B").payoutPaise).toBe(450_000);
    expect(r.notes).toContain("no_points");
  });

  it("rounding remainder to largest fraction, ties by member order", () => {
    const r = calculateContribution(
      input({
        members: ["A", "B", "C"],
        tasks: [task("1", 10, { A: 1 }), task("2", 10, { B: 1 }), task("3", 10, { C: 1 })],
        revenuePaise: 10_100,
      }),
      params,
    );
    expect(r.members.map((m) => m.payoutPaise)).toEqual([3_100, 3_000, 3_000]);
    expect(r.reservePaise).toBe(1_000);
  });

  it("studio-paid expenses are repaid to the studio, not a member", () => {
    const r = calculateContribution(
      input({
        tasks: [task("V", 10, { A: 1 }), task("S", 10, { B: 1 })],
        revenuePaise: 1_000_000,
        expenses: [{ ref: "e1", amountPaise: 100_000, paidBy: null, reimbursable: false }],
      }),
      params,
    );
    expect(r.members.map((m) => m.payoutPaise)).toEqual([405_000, 405_000]);
    expect(r.studioRetainedPaise).toBe(100_000);
    expect(r.reservePaise).toBe(90_000);
  });

  it("is deterministic for the same input", () => {
    const i = input({ tasks: [task("V", 33, { A: 0.3333, B: 0.6667 })], revenuePaise: 1_234_567 });
    expect(JSON.stringify(calculateContribution(i, params))).toBe(JSON.stringify(calculateContribution(i, params)));
  });
});

describe("calculateContribution — post-lock point corrections", () => {
  it("adds positive and negative corrections to the member's other points", () => {
    const r = calculateContribution(
      input({
        tasks: [task("V", 10, { A: 1 }), task("S", 10, { B: 1 })],
        pointAdjustments: [
          { ref: "adj1", memberId: "A", points: 2 },
          { ref: "adj2", memberId: "B", points: -3 },
        ],
      }),
      params,
    );
    expect(member(r, "A").totalPoints).toBe(12);
    expect(member(r, "B").totalPoints).toBe(7);
  });

  it("never lets a member's points go below zero", () => {
    const r = calculateContribution(input({ tasks: [task("V", 10, { A: 1 })], pointAdjustments: [{ ref: "adj", memberId: "B", points: -5 }] }), params);
    expect(member(r, "B").totalPoints).toBe(0);
    expect(r.notes).toContain("negative_points_clamped");
  });
});
