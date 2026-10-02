import type { MilestoneConfig } from "./config";
import type { ClientApprovalRequirement, ClientApprovalStatus, Phase, TaskStatus } from "./types";

export interface GateTaskState {
  code: string;
  status: TaskStatus;
  clientApproval: ClientApprovalRequirement;
  clientApprovalStatus: ClientApprovalStatus | null;
  /** When the task became done (latest of verification and client approval). */
  doneAt: string | null;
}

export interface MilestoneState {
  code: string;
  name: string;
  hardGate: boolean;
  state: "complete" | "pending" | "waived";
  missing: string[];
  waivedTasks: string[];
  achievedAt: string | null;
}

export type MilestoneExtras = Record<string, { ok: boolean; label: string }>;

export function taskDone(t: GateTaskState): boolean {
  const verified = t.status === "verified" || t.status === "locked";
  const approved = t.clientApproval !== "Yes" || t.clientApprovalStatus === "approved" || t.clientApprovalStatus === "deemed_approved";
  return verified && approved;
}

/** Strips a duplicate suffix ("AS-01#2" → "AS-01"). */
export const baseCode = (code: string) => code.split("#")[0] as string;

export function evaluateMilestones(configs: MilestoneConfig[], tasks: GateTaskState[], extras: MilestoneExtras): MilestoneState[] {
  const byCode = new Map<string, GateTaskState[]>();
  for (const t of tasks) {
    const k = baseCode(t.code);
    byCode.set(k, [...(byCode.get(k) ?? []), t]);
  }
  return configs.map((m) => {
    const missing: string[] = [];
    const waivedTasks: string[] = [];
    let achievedAt: string | null = null;
    for (const code of m.complete_when) {
      const live = (byCode.get(code) ?? []).filter((t) => t.status !== "cancelled");
      if (live.length === 0) {
        waivedTasks.push(code);
        continue;
      }
      if (live.every(taskDone)) {
        for (const t of live) if (t.doneAt && (!achievedAt || t.doneAt > achievedAt)) achievedAt = t.doneAt;
      } else missing.push(code);
    }
    const extra = extras[m.code];
    if (extra && !extra.ok) missing.push(extra.label);
    const allWaived = waivedTasks.length === m.complete_when.length && !extra;
    const state = missing.length > 0 ? "pending" : allWaived ? "waived" : "complete";
    return { code: m.code, name: m.name, hardGate: m.hard_gate, state, missing, waivedTasks, achievedAt: state === "complete" ? achievedAt : null };
  });
}

export interface GateBlock {
  milestoneCode: string;
  milestoneName: string;
  missing: string[];
}

/** Returns the first pending hard gate that blocks this task from starting, or null. */
export function gateBlockFor(
  task: { code: string; phase: Phase; categoryCode: string },
  configs: MilestoneConfig[],
  states: MilestoneState[],
): GateBlock | null {
  const code = baseCode(task.code);
  for (const m of configs) {
    if (!m.hard_gate || m.complete_when.includes(code)) continue;
    const blocks =
      (m.blocks_phases ?? []).includes(task.phase) || (m.blocks_tasks ?? []).includes(code) || (m.blocks_categories ?? []).includes(task.categoryCode);
    if (!blocks) continue;
    const s = states.find((x) => x.code === m.code);
    if (s && s.state === "pending") return { milestoneCode: m.code, milestoneName: m.name, missing: s.missing };
  }
  return null;
}
