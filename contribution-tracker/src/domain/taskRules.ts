import type { CalcParams } from "./config";
import type { Strength, TaskStatus } from "./types";

export function assertTransition(from: TaskStatus, to: TaskStatus, transitions: readonly (readonly [string, string])[]): void {
  if (!transitions.some(([a, b]) => a === from && b === to)) {
    throw new Error(`Status change ${from.replace("_", " ")} → ${to.replace("_", " ")} is not allowed`);
  }
}

const RANK: Record<Strength, number> = { weak: 1, medium: 2, strong: 3 };

/** Spec §5: >3 planned points need a strong item; otherwise at least medium. */
export function evidenceCheck(
  plannedPoints: number,
  items: { strength: Strength }[],
  rule: CalcParams["evidence_rule"],
): { ok: boolean; reason?: string } {
  const best = items.reduce((b, i) => Math.max(b, RANK[i.strength]), 0);
  if (plannedPoints > rule.strong_required_above_points) {
    return best >= RANK.strong
      ? { ok: true }
      : { ok: false, reason: `Tasks worth more than ${rule.strong_required_above_points} points need at least one strong evidence item` };
  }
  const min = RANK[rule.min_strength_otherwise];
  return best >= min ? { ok: true } : { ok: false, reason: `Add at least one ${rule.min_strength_otherwise}-or-stronger evidence item` };
}

/**
 * Who may verify a submission (decision D1). Non-contributors verify independently; if every
 * project member contributed, every contributor except the submitter must confirm (joint).
 */
export function verifierEligibility(
  memberIds: number[],
  contributorIds: number[],
  submitterId: number,
): { mode: "independent" | "joint"; eligible: number[] } {
  const contributors = new Set(contributorIds);
  const outsiders = memberIds.filter((m) => !contributors.has(m));
  if (outsiders.length > 0) return { mode: "independent", eligible: outsiders };
  return { mode: "joint", eligible: memberIds.filter((m) => m !== submitterId) };
}

/** Shares are integer basis points (10000 = 100%) and must sum to exactly 10000. */
export function sharesValid(shares: Record<string | number, number>): boolean {
  const values = Object.values(shares);
  if (values.length === 0) return false;
  if (!values.every((v) => Number.isInteger(v) && v >= 0 && v <= 10000)) return false;
  return values.reduce((s, v) => s + v, 0) === 10000 && values.some((v) => v > 0);
}

export function plannedPoints(defaultPoints: number, quantity: number, adjustment: number): number {
  return defaultPoints * quantity * adjustment;
}

export function adjustmentFactorAllowed(factor: number, params: Pick<CalcParams, "adjustment_min" | "adjustment_max">): boolean {
  return Number.isFinite(factor) && factor >= params.adjustment_min - 1e-9 && factor <= params.adjustment_max + 1e-9;
}

/** Decision D17: raising a factor after plan lock needs actual hours > multiple × estimate (unknown estimate: allowed). */
export function effortTriggerMet(actualHours: number, estimateHours: number | null, multiple: number): boolean {
  if (estimateHours === null || estimateHours <= 0) return true;
  return actualHours > multiple * estimateHours;
}

export const ACTIVE_STATUSES: TaskStatus[] = ["planned", "in_progress", "blocked", "submitted"];
export const DONE_STATUSES: TaskStatus[] = ["verified", "locked"];
