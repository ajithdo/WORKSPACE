import { and, eq, inArray } from "drizzle-orm";
import { calculateContribution, type CalcInput, type CalcResult, type CalcTask } from "@/domain/calc";
import type { CalcParams } from "@/domain/config";
import { communicationAwards, communicationQualifies } from "@/domain/communication";
import type { DbOrTx } from "@/db";
import { actionItems, communications, disputes, evidence, expenses, members, payments, reserveLedger, taskContributions, taskInstances, timeEntries } from "@/db/schema";
import { loadProject, projectConfig, projectMemberIds, type ProjectRow } from "./common";

export const ACTIVE_DISPUTE = ["open", "in_discussion", "escalated"] as const;

export interface HeldItems {
  tasks: Set<number>;
  communications: Set<number>;
  expenses: Set<number>;
  adjustments: Set<number>;
}

/** Spec §11 rule 2: while a dispute is open its item's points (or money) are held out of the calculation. */
export function heldItems(tx: DbOrTx, projectId: number): HeldItems {
  const rows = tx
    .select()
    .from(disputes)
    .where(and(eq(disputes.projectId, projectId), inArray(disputes.status, [...ACTIVE_DISPUTE])))
    .all();
  const held: HeldItems = { tasks: new Set(), communications: new Set(), expenses: new Set(), adjustments: new Set() };
  for (const d of rows) {
    if (d.targetType === "task_instance") held.tasks.add(d.targetId);
    if (d.targetType === "communication") held.communications.add(d.targetId);
    if (d.targetType === "expense") held.expenses.add(d.targetId);
    if (d.targetType === "adjustment") held.adjustments.add(d.targetId);
    if (d.targetType === "evidence") {
      const e = tx.select({ subjectType: evidence.subjectType, subjectId: evidence.subjectId }).from(evidence).where(eq(evidence.id, d.targetId)).get();
      if (e?.subjectType === "task") held.tasks.add(e.subjectId);
      if (e?.subjectType === "communication") held.communications.add(e.subjectId);
    }
  }
  return held;
}

export function plannedTotal(tx: DbOrTx, projectId: number): number {
  return tx
    .select()
    .from(taskInstances)
    .where(eq(taskInstances.projectId, projectId))
    .all()
    .filter((t) => t.status !== "proposed" && t.status !== "cancelled")
    .reduce((s, t) => s + t.defaultPoints * t.quantity * t.adjustmentFactor, 0);
}

export function paramsFor(tx: DbOrTx, p: ProjectRow): CalcParams {
  const params = projectConfig(tx, p).calculation;
  // D14: a studio project is paid from the reserve, so no reserve is taken from it again.
  return p.kind === "studio" ? { ...params, reserve_pct: 0 } : params;
}

export function buildCalcInput(tx: DbOrTx, projectId: number): { input: CalcInput; params: CalcParams; held: HeldItems } {
  const p = loadProject(tx, projectId);
  const cfg = projectConfig(tx, p);
  const params = paramsFor(tx, p);
  const memberIds = projectMemberIds(tx, projectId);
  const held = heldItems(tx, projectId);

  const done = tx
    .select()
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, projectId), inArray(taskInstances.status, ["verified", "locked"])))
    .all()
    .filter((t) => !held.tasks.has(t.id));
  const shares = done.length
    ? tx
        .select()
        .from(taskContributions)
        .where(
          inArray(
            taskContributions.taskInstanceId,
            done.map((t) => t.id),
          ),
        )
        .all()
    : [];
  const tasks: CalcTask[] = done.map((t) => ({
    ref: `task:${t.id}:${t.code}`,
    isCommunication: t.isCommunication,
    isSales: t.isSales,
    points: t.defaultPoints,
    quantity: t.quantity,
    adjustment: t.adjustmentFactor,
    multiplier: t.multiplier,
    ownDefect: t.ownDefect,
    shares: Object.fromEntries(shares.filter((s) => s.taskInstanceId === t.id).map((s) => [String(s.memberId), s.shareBp / 10000])),
  }));

  const comms = tx
    .select()
    .from(communications)
    .where(and(eq(communications.projectId, projectId), eq(communications.status, "verified")))
    .all()
    .filter((c) => !held.communications.has(c.id));
  const communicationAwardsList: CalcInput["communicationAwards"] = [];
  for (const c of comms) {
    const type = cfg.communication_types.find((x) => x.code === c.type);
    if (!type) continue;
    const ev = tx
      .select({ type: evidence.type, status: evidence.verificationStatus })
      .from(evidence)
      .where(and(eq(evidence.subjectType, "communication"), eq(evidence.subjectId, c.id)))
      .all()
      .filter((e) => e.status !== "rejected");
    const items = tx.select({ id: actionItems.id }).from(actionItems).where(eq(actionItems.communicationId, c.id)).all();
    if (!communicationQualifies({ summary: c.summary, decisions: c.decisions, actionItemCount: items.length, evidenceTypes: ev.map((e) => e.type) })) continue;
    for (const a of communicationAwards(
      { leadMemberId: c.leadMemberId, secondMemberId: c.secondMemberId, secondRequired: c.secondRequired, multiplier: c.multiplier, splitParties: c.splitParties ?? null },
      type,
    )) {
      if (memberIds.includes(a.memberId)) communicationAwardsList.push({ ref: `comm:${c.id}`, memberId: String(a.memberId), points: a.points });
    }
  }

  const total = plannedTotal(tx, projectId);
  const origination = p.originatedBy !== null && memberIds.includes(p.originatedBy) && total > 0 ? { memberId: String(p.originatedBy), plannedTotal: total } : null;

  let revenuePaise = 0;
  if (p.kind === "studio") {
    revenuePaise = tx
      .select()
      .from(reserveLedger)
      .where(and(eq(reserveLedger.projectId, projectId), eq(reserveLedger.direction, "out"), eq(reserveLedger.status, "approved")))
      .all()
      .reduce((s, r) => s + r.amount, 0);
  } else {
    revenuePaise = tx
      .select()
      .from(payments)
      .where(eq(payments.projectId, projectId))
      .all()
      .filter((x) => x.verifiedBy !== null)
      .reduce((s, x) => s + x.revenueExGst + (params.distribute_tds_credit ? x.tdsDeducted : 0), 0);
  }

  const exps = tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.projectId, projectId), eq(expenses.status, "approved")))
    .all()
    .filter((e) => !held.expenses.has(e.id));

  const input: CalcInput = {
    members: memberIds.map(String),
    tasks,
    communicationAwards: communicationAwardsList,
    origination,
    revenuePaise,
    expenses: exps.map((e) => ({
      ref: `expense:${e.id}`,
      amountPaise: e.acceptedAmount ?? e.amount,
      paidBy: e.paidByMemberId !== null && memberIds.includes(e.paidByMemberId) ? String(e.paidByMemberId) : null,
      reimbursable: e.reimbursable,
    })),
  };
  return { input, params, held };
}

export interface CategoryCalibration {
  categoryCode: string;
  plannedPoints: number;
  verifiedPoints: number;
  hours: number;
  hoursPerPoint: number | null;
  estimatedHours: number;
}

export function categoryCalibration(tx: DbOrTx, projectIds: number[]): CategoryCalibration[] {
  if (projectIds.length === 0) return [];
  const tasks = tx.select().from(taskInstances).where(inArray(taskInstances.projectId, projectIds)).all();
  const minutes = new Map<number, number>();
  if (tasks.length) {
    for (const e of tx
      .select()
      .from(timeEntries)
      .where(
        inArray(
          timeEntries.taskInstanceId,
          tasks.map((t) => t.id),
        ),
      )
      .all())
      minutes.set(e.taskInstanceId, (minutes.get(e.taskInstanceId) ?? 0) + e.minutes);
  }
  const byCat = new Map<string, CategoryCalibration>();
  for (const t of tasks) {
    if (t.status === "cancelled" || t.status === "proposed") continue;
    const c = byCat.get(t.categoryCode) ?? { categoryCode: t.categoryCode, plannedPoints: 0, verifiedPoints: 0, hours: 0, hoursPerPoint: null, estimatedHours: 0 };
    const pts = t.defaultPoints * t.quantity * t.adjustmentFactor;
    c.plannedPoints += pts;
    if (t.status === "verified" || t.status === "locked") c.verifiedPoints += pts;
    c.hours += (minutes.get(t.id) ?? 0) / 60;
    c.estimatedHours += (t.effortMidHours ?? 0) * t.quantity;
    byCat.set(t.categoryCode, c);
  }
  return [...byCat.values()]
    .map((c) => ({ ...c, hoursPerPoint: c.verifiedPoints > 0 && c.hours > 0 ? c.hours / c.verifiedPoints : null }))
    .sort((a, b) => a.categoryCode.localeCompare(b.categoryCode, "en", { numeric: true }));
}

export function liveContribution(tx: DbOrTx, projectId: number) {
  const { input, params, held } = buildCalcInput(tx, projectId);
  const result: CalcResult = calculateContribution(input, params);
  const names = new Map(
    tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .all()
      .map((m) => [String(m.id), m.name]),
  );
  const warnings: string[] = [];
  for (const m of result.members) {
    const n = names.get(m.memberId) ?? m.memberId;
    const raw = m.rawPoints.comm + m.rawPoints.sales + m.rawPoints.micro + m.rawPoints.other;
    if (raw > 0 && m.rawPoints.micro / raw > params.micro_task_cap_pct * 0.9) warnings.push(`${n}: 1-point tasks are near or over the ${Math.round(params.micro_task_cap_pct * 100)}% cap`);
  }
  if (result.caps.communication.applied) warnings.push(`Communication points were scaled down to the ${Math.round(params.communication_cap_pct * 100)}% cap`);
  if (result.caps.sales.applied) warnings.push(`Sales and origination points were scaled down to the ${Math.round(params.sales_cap_pct * 100)}% cap`);
  const heldCount = held.tasks.size + held.communications.size + held.expenses.size + held.adjustments.size;
  if (heldCount) warnings.push(`${heldCount} disputed item(s) are held out until resolved`);
  return { input, params, result, held, names, warnings, calibration: categoryCalibration(tx, [projectId]) };
}
