import type { CalcParams } from "./config";

/**
 * Contribution calculation (spec §10), ported from docs/spec/reference_calc.py.
 *
 * Pure and deterministic: the same input and parameters always give the same output, so a
 * locked snapshot can be recomputed and its hash compared. Points follow the reference exactly
 * (same summation order); money follows the reference's rupee arithmetic, extended for
 * studio-paid expenses (D14), loss-making projects (D7) and projects with no points yet (D8).
 */

export const CALC_VERSION = 1;

export interface CalcTask {
  ref: string;
  isCommunication: boolean;
  isSales: boolean;
  /** Default (per-unit) points snapshotted from the library into the plan. */
  points: number;
  quantity: number;
  adjustment: number;
  /** Dispute outcome: 1 normal, 0 voided, 0.5 halved. */
  multiplier?: number;
  ownDefect: boolean;
  /** memberId → fraction; must add up to 1. */
  shares: Record<string, number>;
}

export interface CalcAward {
  ref: string;
  memberId: string;
  points: number;
}

export interface CalcExpense {
  ref: string;
  amountPaise: number;
  /** null = paid from the studio's own account. */
  paidBy: string | null;
  reimbursable: boolean;
}

export interface CalcInput {
  members: string[];
  tasks: CalcTask[];
  communicationAwards: CalcAward[];
  origination: { memberId: string; plannedTotal: number } | null;
  revenuePaise: number;
  expenses: CalcExpense[];
}

export interface KindPoints {
  comm: number;
  sales: number;
  micro: number;
  other: number;
}

export interface CapInfo {
  applied: boolean;
  before: number;
  after: number;
}

export interface MemberCalc {
  memberId: string;
  rawPoints: KindPoints;
  points: KindPoints;
  totalPoints: number;
  share: number;
  adjustmentPoints: number;
  reimbursementDuePaise: number;
  reimbursementPaidPaise: number;
  shortfallPaise: number;
  basePaise: number;
  poolPaise: number;
  payoutPaise: number;
  equalSplitPaise: number;
}

export interface CalcResult {
  calcVersion: number;
  members: MemberCalc[];
  revenuePaise: number;
  expensesPaise: number;
  profitPaise: number;
  reserveExactPaise: number;
  /** Reserve actually kept: absorbs the sub-rupee rounding so totals reconcile exactly. */
  reservePaise: number;
  /** Repayment to the studio account of expenses it paid itself. */
  studioRetainedPaise: number;
  distributablePaise: number;
  payoutTotalPaise: number;
  totalRawPoints: number;
  totalPoints: number;
  caps: { communication: CapInfo; sales: CapInfo; micro: Record<string, CapInfo> };
  notes: string[];
}

const KINDS = ["comm", "sales", "micro", "other"] as const;
type Kind = (typeof KINDS)[number];

const sumKinds = (v: KindPoints) => v.comm + v.sales + v.micro + v.other;

function assertFinite(n: number, what: string) {
  if (!Number.isFinite(n)) throw new Error(`${what} must be a finite number`);
}

function validate(input: CalcInput) {
  if (input.members.length === 0) throw new Error("A calculation needs at least one member");
  const members = new Set(input.members);
  if (members.size !== input.members.length) throw new Error("Members must be unique");
  const known = (id: string, where: string) => {
    if (!members.has(id)) throw new Error(`${where}: ${id} is not a project member`);
  };
  for (const t of input.tasks) {
    assertFinite(t.points, `Task ${t.ref} points`);
    assertFinite(t.quantity, `Task ${t.ref} quantity`);
    assertFinite(t.adjustment, `Task ${t.ref} adjustment`);
    if (t.points < 0 || t.quantity < 0 || t.adjustment <= 0) throw new Error(`Task ${t.ref} has negative points, quantity or adjustment`);
    let total = 0;
    for (const [m, s] of Object.entries(t.shares)) {
      known(m, `Task ${t.ref}`);
      assertFinite(s, `Task ${t.ref} share`);
      if (s < 0) throw new Error(`Task ${t.ref} has a negative share`);
      total += s;
    }
    if (Math.abs(total - 1) > 1e-6) throw new Error(`Shares for task ${t.ref} must add up to 100% (got ${(total * 100).toFixed(2)}%)`);
  }
  for (const a of input.communicationAwards) {
    known(a.memberId, `Communication ${a.ref}`);
    assertFinite(a.points, `Communication ${a.ref} points`);
  }
  if (input.origination) known(input.origination.memberId, "Origination");
  if (!Number.isSafeInteger(input.revenuePaise) || input.revenuePaise < 0) throw new Error("Revenue must be a non-negative whole number of paise");
  for (const e of input.expenses) {
    if (!Number.isSafeInteger(e.amountPaise) || e.amountPaise < 0) throw new Error(`Expense ${e.ref} must be a non-negative whole number of paise`);
    if (e.paidBy !== null) known(e.paidBy, `Expense ${e.ref}`);
  }
}

export function calculateContribution(input: CalcInput, params: CalcParams): CalcResult {
  validate(input);
  const notes: string[] = [];
  const pts: Record<string, KindPoints> = {};
  const adjustmentPoints: Record<string, number> = {};
  for (const m of input.members) {
    pts[m] = { comm: 0, sales: 0, micro: 0, other: 0 };
    adjustmentPoints[m] = 0;
  }
  const at = (m: string) => pts[m] as KindPoints;

  // Steps 1–2: verified tasks × quantity × adjustment × share; own defects earn own_defect_fix_points.
  for (const t of input.tasks) {
    const perUnit = t.ownDefect ? params.own_defect_fix_points : t.points;
    const multiplier = t.multiplier ?? 1;
    const base = perUnit * t.quantity * t.adjustment * multiplier;
    const unadjusted = perUnit * t.quantity * multiplier;
    const kind: Kind = t.isCommunication ? "comm" : t.isSales ? "sales" : t.points <= params.micro_task_points_threshold ? "micro" : "other";
    for (const [m, s] of Object.entries(t.shares)) {
      at(m)[kind] += base * s;
      adjustmentPoints[m] = (adjustmentPoints[m] ?? 0) + (base - unadjusted) * s;
    }
  }
  // Step 3: qualifying communications.
  for (const a of input.communicationAwards) at(a.memberId).comm += a.points;
  // Step 4: origination credit counts as sales.
  if (input.origination) at(input.origination.memberId).sales += params.origination_credit_pct * input.origination.plannedTotal;

  const rawPoints: Record<string, KindPoints> = {};
  for (const m of input.members) rawPoints[m] = { ...at(m) };
  const grandTotal = () => input.members.reduce((s, m) => s + sumKinds(at(m)), 0);
  const totalRawPoints = grandTotal();

  // Step 5: project-wide caps (communication, then sales), then each member's micro-task cap.
  const projectCap = (kind: "comm" | "sales", cap: number): CapInfo => {
    const kt = input.members.reduce((s, m) => s + at(m)[kind], 0);
    const gt = grandTotal();
    if (gt && kt > cap * gt) {
      const target = (cap * (gt - kt)) / (1 - cap);
      const ratio = target / kt;
      for (const m of input.members) at(m)[kind] *= ratio;
      return { applied: true, before: kt, after: input.members.reduce((s, m) => s + at(m)[kind], 0) };
    }
    return { applied: false, before: kt, after: kt };
  };
  const communication = projectCap("comm", params.communication_cap_pct);
  const sales = projectCap("sales", params.sales_cap_pct);
  const micro: Record<string, CapInfo> = {};
  for (const m of input.members) {
    const v = at(m);
    const mt = sumKinds(v);
    const before = v.micro;
    if (mt && v.micro > params.micro_task_cap_pct * mt) {
      v.micro = (params.micro_task_cap_pct * (mt - v.micro)) / (1 - params.micro_task_cap_pct);
      micro[m] = { applied: true, before, after: v.micro };
    } else micro[m] = { applied: false, before, after: before };
  }

  // Step 6: shares of the pool.
  const memberPoints = Object.fromEntries(input.members.map((m) => [m, sumKinds(at(m))]));
  const totalPoints = input.members.reduce((s, m) => s + (memberPoints[m] ?? 0), 0);
  if (!(totalPoints > 0)) notes.push("no_points");
  const share = (m: string) => (totalPoints > 0 ? (memberPoints[m] ?? 0) / totalPoints : 1 / input.members.length);

  // Step 7: money waterfall, in rupees like the reference, on cash received.
  const R = input.revenuePaise;
  const E = input.expenses.reduce((s, e) => s + e.amountPaise, 0);
  const reimbDue: Record<string, number> = Object.fromEntries(input.members.map((m) => [m, 0]));
  let studioPaid = 0;
  for (const e of input.expenses) {
    if (e.paidBy !== null && e.reimbursable) reimbDue[e.paidBy] = (reimbDue[e.paidBy] ?? 0) + e.amountPaise;
    else studioPaid += e.amountPaise;
  }
  const n = input.members.length;
  const rev = R / 100;
  const exp = E / 100;

  let reserveExact = 0;
  let dist = 0;
  let studioRetainedRupees = studioPaid / 100;
  const reimbPaid: Record<string, number> = {};
  const base: Record<string, number> = {};
  const pool: Record<string, number> = {};
  const raw: Record<string, number> = {};
  if (R >= E) {
    reserveExact = params.reserve_pct * (rev - exp);
    dist = rev - exp - reserveExact;
    for (const m of input.members) {
      reimbPaid[m] = (reimbDue[m] ?? 0) / 100;
      base[m] = (params.base_share_pct * dist) / n;
      pool[m] = params.pool_pct * dist * share(m);
      raw[m] = (reimbPaid[m] ?? 0) + (base[m] ?? 0) + (pool[m] ?? 0);
    }
  } else {
    // D7: revenue does not cover expenses — no reserve, no profit; repay expenses pro rata.
    notes.push("loss");
    const ratio = E > 0 ? R / E : 0;
    studioRetainedRupees = (studioPaid * ratio) / 100;
    for (const m of input.members) {
      reimbPaid[m] = ((reimbDue[m] ?? 0) * ratio) / 100;
      base[m] = 0;
      pool[m] = 0;
      raw[m] = reimbPaid[m] ?? 0;
    }
  }

  // Step 8: round to the rupee; remainder to the largest fractional parts (ties: member order).
  const targetTotal = roundHalfUp(rev - reserveExact - studioRetainedRupees);
  const floored: Record<string, number> = Object.fromEntries(input.members.map((m) => [m, Math.floor(raw[m] ?? 0)]));
  let rem = targetTotal - input.members.reduce((s, m) => s + (floored[m] ?? 0), 0);
  const order = input.members
    .map((m, i) => ({ m, i, frac: (raw[m] ?? 0) - Math.floor(raw[m] ?? 0) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { m } of order) {
    if (rem <= 0) break;
    floored[m] = (floored[m] ?? 0) + 1;
    rem -= 1;
  }
  for (let i = order.length - 1; rem < 0 && i >= 0; i--) {
    // Only reachable through float error; take the excess back from the smallest fractions.
    const m = order[i]?.m as string;
    floored[m] = (floored[m] ?? 0) - 1;
    rem += 1;
  }

  const payoutTotalPaise = input.members.reduce((s, m) => s + (floored[m] ?? 0) * 100, 0);
  const studioRetainedPaise = R >= E ? studioPaid : Math.max(0, R - payoutTotalPaise);
  const reservePaise = R - payoutTotalPaise - studioRetainedPaise;
  const toPaise = (rupees: number) => Math.round(rupees * 100);

  const members: MemberCalc[] = input.members.map((m) => {
    const paid = toPaise(reimbPaid[m] ?? 0);
    return {
      memberId: m,
      rawPoints: rawPoints[m] as KindPoints,
      points: { ...at(m) },
      totalPoints: memberPoints[m] ?? 0,
      share: share(m),
      adjustmentPoints: adjustmentPoints[m] ?? 0,
      reimbursementDuePaise: reimbDue[m] ?? 0,
      reimbursementPaidPaise: paid,
      shortfallPaise: (reimbDue[m] ?? 0) - paid,
      basePaise: toPaise(base[m] ?? 0),
      poolPaise: toPaise(pool[m] ?? 0),
      payoutPaise: (floored[m] ?? 0) * 100,
      equalSplitPaise: paid + toPaise(dist / n),
    };
  });

  return {
    calcVersion: CALC_VERSION,
    members,
    revenuePaise: R,
    expensesPaise: E,
    profitPaise: R - E,
    reserveExactPaise: toPaise(reserveExact),
    reservePaise,
    studioRetainedPaise,
    distributablePaise: toPaise(dist),
    payoutTotalPaise,
    totalRawPoints,
    totalPoints,
    caps: { communication, sales, micro },
    notes,
  };
}

function roundHalfUp(x: number): number {
  // Guard against representation error just below .5 (e.g. 90.49999999999999 meant as 90.5).
  return Math.floor(x + 0.5 + 1e-9);
}

export { KINDS };
