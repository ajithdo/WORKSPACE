import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import seedConfig from "../../seed/seed_config.json";
import { calculateContribution, type CalcInput } from "@/domain/calc";
import { parseStudioConfig } from "@/domain/config";

const params = parseStudioConfig(seedConfig).calculation;
const harness = path.resolve(__dirname, "../../scripts/reference_calc_harness.py");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

// Small deterministic PRNG so the 200 cases are the same on every run.
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type RefCase = {
  members: string[];
  tasks: { cat: string; points: number; qty: number; adj: number; own_defect: boolean; shares: Record<string, number> }[];
  comms: { lead: string; lead_points: number; second: string | null; second_points: number; second_required: boolean }[];
  finance: { revenue_ex_gst: number; expenses: { amount: number; paid_by: string }[] };
  planned_total: number | null;
  originated_by: string | null;
};

function makeCase(rand: () => number): RefCase {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)] as T;
  const members = rand() < 0.7 ? ["A", "B"] : ["A", "B", "C"];
  const tasks: RefCase["tasks"] = [{ cat: "V", points: pick([5, 10, 20]), qty: 1, adj: 1, own_defect: false, shares: { A: 1 } }];
  const n = 1 + Math.floor(rand() * 14);
  for (let i = 0; i < n; i++) {
    const owner = pick(members);
    const other = pick(members.filter((m) => m !== owner));
    tasks.push({
      cat: pick(["V", "S", "K", "A", "C", "W", "K"]),
      points: pick([1, 1, 1, 2, 3, 4, 5, 10, 20]),
      qty: pick([1, 1, 2, 3]),
      adj: pick([1, 1, 0.5, 1.25, 1.5]),
      own_defect: rand() < 0.1,
      shares: rand() < 0.7 ? { [owner]: 1 } : { [owner]: 0.5, [other]: 0.5 },
    });
  }
  const comms: RefCase["comms"] = [];
  const c = Math.floor(rand() * 5);
  for (let i = 0; i < c; i++) {
    const lead = pick(members);
    comms.push({ lead, lead_points: pick([1, 2, 3]), second: pick(members.filter((m) => m !== lead)), second_points: pick([0, 1, 2]), second_required: rand() < 0.5 });
  }
  const expenses = Array.from({ length: Math.floor(rand() * 4) }, () => ({ amount: 10 * Math.floor(rand() * 500), paid_by: pick(members) }));
  const expTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const revenue = expTotal + 10 * (1000 + Math.floor(rand() * 50000));
  const originated = rand() < 0.5;
  return {
    members,
    tasks,
    comms,
    finance: { revenue_ex_gst: revenue, expenses },
    planned_total: originated ? tasks.reduce((s, t) => s + t.points * t.qty, 0) : null,
    originated_by: originated ? pick(members) : null,
  };
}

function toInput(rc: RefCase): CalcInput {
  return {
    members: rc.members,
    tasks: rc.tasks.map((t, i) => ({
      ref: `t${i}`,
      isCommunication: t.cat === "K",
      isSales: ["A", "B", "C"].includes(t.cat),
      points: t.points,
      quantity: t.qty,
      adjustment: t.adj,
      ownDefect: t.own_defect,
      shares: t.shares,
    })),
    communicationAwards: rc.comms.flatMap((c, i) => [
      { ref: `c${i}`, memberId: c.lead, points: c.lead_points },
      ...(c.second && c.second_required ? [{ ref: `c${i}b`, memberId: c.second, points: c.second_points }] : []),
    ]),
    origination: rc.originated_by && rc.planned_total ? { memberId: rc.originated_by, plannedTotal: rc.planned_total } : null,
    revenuePaise: rc.finance.revenue_ex_gst * 100,
    expenses: rc.finance.expenses.map((e, i) => ({ ref: `e${i}`, amountPaise: e.amount * 100, paidBy: e.paid_by, reimbursable: true })),
  };
}

describe.skipIf(!hasPython)("calculateContribution vs reference_calc.py", () => {
  it("matches python reference on 200 random cases", () => {
    const rand = prng(20260928);
    const cases = Array.from({ length: 200 }, () => makeCase(rand));
    const run = spawnSync("python3", [harness], { input: JSON.stringify({ params, cases }), encoding: "utf-8" });
    expect(run.status, run.stderr).toBe(0);
    const expected = JSON.parse(run.stdout) as Record<string, { points: number; share: number; payout: number }>[];
    cases.forEach((rc, i) => {
      const got = calculateContribution(toInput(rc), params);
      for (const m of rc.members) {
        const ref = expected[i]?.[m];
        const mine = got.members.find((x) => x.memberId === m);
        expect(mine, `case ${i} member ${m}`).toBeDefined();
        expect(Math.abs((mine?.totalPoints ?? 0) - (ref?.points ?? NaN)), `case ${i} points ${m}`).toBeLessThanOrEqual(0.005 + 1e-9);
        expect(mine?.share, `case ${i} share ${m}`).toBeCloseTo(ref?.share ?? NaN, 9);
        expect(mine?.payoutPaise, `case ${i} payout ${m}`).toBe((ref?.payout ?? NaN) * 100);
      }
    });
  });
});
