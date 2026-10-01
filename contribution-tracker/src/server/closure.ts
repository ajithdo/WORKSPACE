import { and, desc, eq, inArray } from "drizzle-orm";
import { calculateContribution, CALC_VERSION, type CalcInput, type CalcResult } from "@/domain/calc";
import type { CalcParams } from "@/domain/config";
import { canonicalJson, sha256Hex } from "@/domain/canonical";
import type { AppDb, DbOrTx } from "@/db";
import { closureItems, contributionSnapshots, distributions, expenses, postLockAdjustments, projects, reserveLedger, retroItems, taskInstances } from "@/db/schema";
import { allApproved, castVote } from "./approvals";
import type { Ctx } from "./context";
import { iso, isoDate } from "./context";
import { assertProjectMember, audit, loadProject, nonEmpty, projectConfig, projectMemberIds, requireActor, type ProjectRow } from "./common";
import { ACTIVE_DISPUTE, buildCalcInput } from "./contribution";
import { DomainError } from "./errors";
import { financeSummary } from "./finance";
import { handoverStatus } from "./handover";
import { disputes } from "@/db/schema";

export type SnapshotRow = typeof contributionSnapshots.$inferSelect;

/** Indexes of the closure checklist (seed_config.closure_checklist) that partners tick by hand. */
export const MANUAL_ITEMS = [6, 9, 10, 11];
/** Items 0–6 must be satisfied before the snapshot is computed (decision D13). */
const BEFORE_SNAPSHOT = [0, 1, 2, 3, 4, 5, 6];

export interface ChecklistItem {
  index: number;
  label: string;
  manual: boolean;
  done: boolean;
  detail: string;
  note: string;
}

export function snapshotHash(doc: { calcVersion: number; configVersionId: number; inputs: unknown; params: unknown; outputs: unknown }): string {
  return sha256Hex(canonicalJson(doc));
}

function latestSnapshot(tx: DbOrTx, projectId: number, status?: SnapshotRow["status"]): SnapshotRow | undefined {
  const rows = tx.select().from(contributionSnapshots).where(eq(contributionSnapshots.projectId, projectId)).orderBy(desc(contributionSnapshots.seq)).all();
  return status ? rows.find((r) => r.status === status) : rows[0];
}

export function closureChecklist(tx: DbOrTx, projectId: number): ChecklistItem[] {
  const p = loadProject(tx, projectId);
  const labels = projectConfig(tx, p).closure_checklist;
  const manual = new Map(
    tx
      .select()
      .from(closureItems)
      .where(eq(closureItems.projectId, projectId))
      .all()
      .map((r) => [r.itemIndex, r]),
  );
  const tasks = tx.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const openTasks = tasks.filter((t) => !["verified", "locked", "cancelled"].includes(t.status));
  const openDisputes = tx
    .select()
    .from(disputes)
    .where(and(eq(disputes.projectId, projectId), inArray(disputes.status, [...ACTIVE_DISPUTE])))
    .all();
  const fin = financeSummary(tx, projectId);
  const pendingExpenses = tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.projectId, projectId), eq(expenses.status, "pending")))
    .all().length;
  const handover = p.kind === "client" ? handoverStatus(tx, projectId) : null;
  const retros = tx.select().from(retroItems).where(eq(retroItems.projectId, projectId)).all();
  const unaddressedRetro = retros.filter((r) => !r.addressed);
  const locked = latestSnapshot(tx, projectId, "locked");
  const dists = locked ? tx.select().from(distributions).where(eq(distributions.projectId, projectId)).all() : [];
  const unpaid = dists.filter((d) => !d.paidOn && d.total !== 0);

  const auto: Record<number, { done: boolean; detail: string }> = {
    0: { done: openTasks.length === 0, detail: openTasks.length ? `${openTasks.length} task(s) not verified or cancelled: ${openTasks.slice(0, 5).map((t) => t.code).join(", ")}${openTasks.length > 5 ? "…" : ""}` : "All done" },
    1: { done: openDisputes.length === 0, detail: openDisputes.length ? `${openDisputes.length} open dispute(s)` : "None open" },
    2: {
      done: fin.unsettledInvoices === 0 && fin.draftInvoices === 0,
      detail: fin.unsettledInvoices || fin.draftInvoices ? `${fin.unsettledInvoices} unpaid and ${fin.draftInvoices} draft invoice(s)` : "All invoices paid or written off",
    },
    3: { done: true, detail: fin.tdsCertificatesPending ? `${fin.tdsCertificatesPending} TDS certificate(s) marked pending` : "Nothing pending" },
    4: { done: pendingExpenses === 0, detail: pendingExpenses ? `${pendingExpenses} expense(s) awaiting approval` : "All expenses reviewed; reimbursements are paid with the distribution" },
    5: { done: handover?.complete ?? true, detail: handover ? `${handover.done}/${handover.applicable} applicable items complete` : "Not a client project" },
    7: { done: !!locked, detail: locked ? `Locked ${locked.lockedAt?.slice(0, 10)} · hash ${locked.hash.slice(0, 12)}…` : "Not yet" },
    8: { done: !!locked && unpaid.length === 0, detail: locked ? (unpaid.length ? `${unpaid.length} payout(s) not marked paid` : "All payouts recorded") : "After the snapshot is locked" },
  };
  return labels.map((label, index) => {
    const m = manual.get(index);
    if (MANUAL_ITEMS.includes(index)) {
      const retroBlock = index === 6 && unaddressedRetro.length > 0;
      return {
        index,
        label,
        manual: true,
        done: !!m?.done && !retroBlock,
        detail: retroBlock ? `${unaddressedRetro.length} retrospective item(s) still to address` : m?.done ? `Confirmed${m.note ? `: ${m.note}` : ""}` : "Tick when done",
        note: m?.note ?? "",
      };
    }
    const a = auto[index] ?? { done: false, detail: "" };
    return { index, label, manual: false, done: a.done, detail: a.detail, note: "" };
  });
}

export function startClosing(ctx: Ctx, projectId: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectMember(tx, p.id, actor);
    if (p.closeStatus !== "open") throw new DomainError("conflict", "Closing has already started");
    tx.update(projects).set({ closeStatus: "closing", updatedAt: iso(ctx.now) }).where(eq(projects.id, p.id)).run();
    audit(tx, ctx, "closure.start", "project", p.id, p.id, { closeStatus: "open" }, { closeStatus: "closing" });
  });
}

export function setClosureItem(ctx: Ctx, projectId: number, index: number, input: { done: boolean; note?: string }) {
  const actor = requireActor(ctx);
  if (!MANUAL_ITEMS.includes(index)) throw new DomainError("invalid", "This checklist item is checked automatically");
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectMember(tx, p.id, actor);
    if (index === 6 && p.closeStatus === "closed_locked") throw new DomainError("locked", "The retrospective is part of the locked closure");
    const existing = tx
      .select()
      .from(closureItems)
      .where(and(eq(closureItems.projectId, projectId), eq(closureItems.itemIndex, index)))
      .get();
    const values = { done: input.done, note: input.note?.trim() ?? "", doneBy: input.done ? actor : null, doneAt: input.done ? iso(ctx.now) : null };
    if (existing) tx.update(closureItems).set(values).where(eq(closureItems.id, existing.id)).run();
    else tx.insert(closureItems).values({ projectId, itemIndex: index, ...values }).run();
    audit(tx, ctx, "closure.item", "project", p.id, p.id, existing ?? undefined, { index, ...values });
  });
}

export function addRetroItem(ctx: Ctx, projectId: number, text: string) {
  const actor = requireActor(ctx);
  const body = nonEmpty(text, "Retrospective note");
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectMember(tx, p.id, actor);
    const id = tx.insert(retroItems).values({ projectId, text: body, source: "manual", createdBy: actor, createdAt: iso(ctx.now) }).returning({ id: retroItems.id }).get().id;
    audit(tx, ctx, "retro.add", "retro_item", id, p.id, undefined, { text: body });
  });
}

export function addressRetroItem(ctx: Ctx, retroId: number, note: string) {
  const actor = requireActor(ctx);
  const body = nonEmpty(note, "What was agreed");
  ctx.db.transaction((tx) => {
    const r = tx.select().from(retroItems).where(eq(retroItems.id, retroId)).get();
    if (!r) throw new DomainError("not_found", "Retrospective item not found");
    assertProjectMember(tx, r.projectId, actor);
    tx.update(retroItems).set({ addressed: true, addressedNote: body }).where(eq(retroItems.id, retroId)).run();
    audit(tx, ctx, "retro.address", "retro_item", retroId, r.projectId, { addressed: false }, { addressed: true, note: body });
  });
}

function snapshotDoc(p: ProjectRow, input: CalcInput, params: CalcParams, outputs: CalcResult) {
  return { calcVersion: CALC_VERSION, configVersionId: p.configVersionId, inputs: input, params, outputs };
}

export function computeSnapshot(ctx: Ctx, projectId: number): { snapshotId: number; hash: string } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectMember(tx, p.id, actor);
    if (p.closeStatus === "awaiting_partner") throw new DomainError("conflict", "A snapshot is already waiting for approval");
    if (p.closeStatus !== "closing") throw new DomainError("conflict", "Start closing the project first");
    const list = closureChecklist(tx, projectId);
    const blocker = list.find((i) => BEFORE_SNAPSHOT.includes(i.index) && !i.done);
    if (blocker) throw new DomainError("conflict", `Not ready to close: "${blocker.label}" — ${blocker.detail}`);
    const { input, params } = buildCalcInput(tx, projectId);
    const outputs = calculateContribution(input, params);
    const doc = snapshotDoc(p, input, params, outputs);
    const hash = snapshotHash(doc);
    const seq = (latestSnapshot(tx, projectId)?.seq ?? 0) + 1;
    const id = tx
      .insert(contributionSnapshots)
      .values({
        projectId,
        kind: "closure",
        seq,
        period: isoDate(ctx.now).slice(0, 7),
        status: "awaiting_partner",
        inputs: input,
        params,
        outputs,
        hash,
        calcVersion: CALC_VERSION,
        configVersionId: p.configVersionId,
        createdBy: actor,
        createdAt: iso(ctx.now),
      })
      .returning({ id: contributionSnapshots.id })
      .get().id;
    tx.update(projects).set({ closeStatus: "awaiting_partner", updatedAt: iso(ctx.now) }).where(eq(projects.id, p.id)).run();
    castVote(tx, { subjectType: "snapshot", subjectId: id, round: 1, memberId: actor, decision: "approve", now: ctx.now, label: "snapshot" });
    audit(tx, ctx, "snapshot.compute", "snapshot", id, p.id, undefined, { seq, hash, payouts: outputs.members.map((m) => ({ member: m.memberId, payout: m.payoutPaise })) });
    maybeLock(tx, ctx, id);
    return { snapshotId: id, hash };
  });
}

function loadSnapshot(tx: DbOrTx, id: number): SnapshotRow {
  const s = tx.select().from(contributionSnapshots).where(eq(contributionSnapshots.id, id)).get();
  if (!s) throw new DomainError("not_found", "Snapshot not found");
  return s;
}

function maybeLock(tx: DbOrTx, ctx: Ctx, snapshotId: number) {
  const s = loadSnapshot(tx, snapshotId);
  const p = loadProject(tx, s.projectId);
  if (!allApproved(tx, "snapshot", s.id, s.round, projectMemberIds(tx, p.id))) return false;
  const now = iso(ctx.now);
  const outputs = s.outputs as CalcResult;
  tx.update(taskInstances)
    .set({ status: "locked", lockedAt: now, updatedAt: now })
    .where(and(eq(taskInstances.projectId, p.id), eq(taskInstances.status, "verified")))
    .run();
  writeDistributions(tx, s, outputs, null);
  if (outputs.reservePaise !== 0) {
    tx.insert(reserveLedger)
      .values({ entryDate: isoDate(ctx.now), projectId: p.id, amount: outputs.reservePaise, direction: "in", purpose: `Reserve from ${p.code} closure`, snapshotId: s.id, status: "approved", createdBy: ctx.actorId, createdAt: now })
      .run();
  }
  tx.update(contributionSnapshots).set({ status: "locked", lockedAt: now }).where(eq(contributionSnapshots.id, s.id)).run();
  tx.update(projects).set({ closeStatus: "closed_locked", closedAt: now, updatedAt: now }).where(eq(projects.id, p.id)).run();
  audit(tx, ctx, "project.lock", "project", p.id, p.id, { closeStatus: "awaiting_partner" }, { closeStatus: "closed_locked", snapshotId: s.id, hash: s.hash });
  return true;
}

function writeDistributions(tx: DbOrTx, s: SnapshotRow, outputs: CalcResult, previous: CalcResult | null) {
  for (const m of outputs.members) {
    const prev = previous?.members.find((x) => x.memberId === m.memberId);
    tx.insert(distributions)
      .values({
        snapshotId: s.id,
        projectId: s.projectId,
        memberId: Number(m.memberId),
        reimbursement: m.reimbursementPaidPaise - (prev?.reimbursementPaidPaise ?? 0),
        baseShare: m.basePaise - (prev?.basePaise ?? 0),
        poolShare: m.poolPaise - (prev?.poolPaise ?? 0),
        total: m.payoutPaise - (prev?.payoutPaise ?? 0),
        shortfall: m.shortfallPaise - (prev?.shortfallPaise ?? 0),
      })
      .run();
  }
}

export function approveSnapshot(ctx: Ctx, snapshotId: number): { locked: boolean } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const s = loadSnapshot(tx, snapshotId);
    assertProjectMember(tx, s.projectId, actor);
    if (s.status !== "awaiting_partner") throw new DomainError("conflict", "This snapshot is not waiting for approval");
    castVote(tx, { subjectType: "snapshot", subjectId: s.id, round: s.round, memberId: actor, decision: "approve", now: ctx.now, label: "snapshot" });
    audit(tx, ctx, "snapshot.approve", "snapshot", s.id, s.projectId, undefined, { hash: s.hash });
    return { locked: maybeLock(tx, ctx, s.id) };
  });
}

export function rejectSnapshot(ctx: Ctx, snapshotId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const s = loadSnapshot(tx, snapshotId);
    assertProjectMember(tx, s.projectId, actor);
    if (s.status !== "awaiting_partner") throw new DomainError("conflict", "This snapshot is not waiting for approval");
    if (s.createdBy !== actor) castVote(tx, { subjectType: "snapshot", subjectId: s.id, round: s.round, memberId: actor, decision: "reject", note: why, now: ctx.now, label: "snapshot" });
    tx.update(contributionSnapshots).set({ status: "rejected", rejectedReason: why }).where(eq(contributionSnapshots.id, s.id)).run();
    tx.update(projects).set({ closeStatus: "closing", updatedAt: iso(ctx.now) }).where(eq(projects.id, s.projectId)).run();
    audit(tx, ctx, "snapshot.reject", "snapshot", s.id, s.projectId, { status: "awaiting_partner" }, { status: "rejected", reason: why });
  });
}

/** Recomputes a snapshot from its stored inputs and parameters and compares the hash. */
export function reverifySnapshot(db: AppDb, snapshotId: number): { ok: boolean; storedHash: string; recomputedHash: string; outputsMatch: boolean } {
  const s = loadSnapshot(db, snapshotId);
  const outputs = calculateContribution(s.inputs as CalcInput, s.params as CalcParams);
  const recomputedHash = snapshotHash({ calcVersion: s.calcVersion, configVersionId: s.configVersionId, inputs: s.inputs, params: s.params, outputs });
  const storedDocHash = snapshotHash({ calcVersion: s.calcVersion, configVersionId: s.configVersionId, inputs: s.inputs, params: s.params, outputs: s.outputs });
  return { ok: recomputedHash === s.hash && storedDocHash === s.hash, storedHash: s.hash, recomputedHash, outputsMatch: canonicalJson(outputs) === canonicalJson(s.outputs) };
}

export function recordDistributionPayment(ctx: Ctx, distributionId: number, input: { paidOn: string; bankReference: string }) {
  const actor = requireActor(ctx);
  const ref = nonEmpty(input.bankReference, "Bank reference");
  ctx.db.transaction((tx) => {
    const d = tx.select().from(distributions).where(eq(distributions.id, distributionId)).get();
    if (!d) throw new DomainError("not_found", "Payout not found");
    assertProjectMember(tx, d.projectId, actor);
    if (d.paidOn) throw new DomainError("conflict", "This payout is already recorded as paid");
    tx.update(distributions).set({ paidOn: input.paidOn, bankReference: ref, recordedBy: actor, recordedAt: iso(ctx.now) }).where(eq(distributions.id, distributionId)).run();
    audit(tx, ctx, "distribution.paid", "distribution", distributionId, d.projectId, undefined, { paidOn: input.paidOn, bankReference: ref, total: d.total });
  });
}

export interface PostLockInput {
  reason: string;
  revenueDeltaPaise: number;
  expenses: { amountPaise: number; paidBy: number | null; description: string }[];
  points: { memberId: number; points: number; note: string }[];
  period?: string;
}

/** Spec §10: corrections after lock are new entries in a later period, approved by every partner. */
export function requestPostLockAdjustment(ctx: Ctx, projectId: number, input: PostLockInput): { adjustmentId: number } {
  const actor = requireActor(ctx);
  const reason = nonEmpty(input.reason, "A reason");
  if (!Number.isSafeInteger(input.revenueDeltaPaise)) throw new DomainError("invalid", "Revenue change must be in whole paise");
  if (input.revenueDeltaPaise === 0 && input.expenses.length === 0 && input.points.length === 0) throw new DomainError("invalid", "Nothing to adjust");
  for (const e of input.expenses) if (!Number.isSafeInteger(e.amountPaise) || e.amountPaise <= 0) throw new DomainError("invalid", "Expenses must be positive amounts");
  for (const pt of input.points) if (!Number.isFinite(pt.points) || pt.points === 0) throw new DomainError("invalid", "Point corrections must be non-zero numbers");
  return ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectMember(tx, p.id, actor);
    if (p.closeStatus !== "closed_locked") throw new DomainError("conflict", "Post-lock adjustments are for locked projects; edit the open project instead");
    const members = projectMemberIds(tx, p.id);
    for (const pt of input.points) if (!members.includes(pt.memberId)) throw new DomainError("invalid", "Point corrections must be for project members");
    for (const e of input.expenses) if (e.paidBy !== null && !members.includes(e.paidBy)) throw new DomainError("invalid", "Expenses must be paid by a project member or the studio");
    const id = tx
      .insert(postLockAdjustments)
      .values({
        projectId: p.id,
        period: input.period ?? isoDate(ctx.now).slice(0, 7),
        reason,
        payload: { revenueDeltaPaise: input.revenueDeltaPaise, expenses: input.expenses, points: input.points },
        status: "requested",
        requestedBy: actor,
        requestedAt: iso(ctx.now),
      })
      .returning({ id: postLockAdjustments.id })
      .get().id;
    castVote(tx, { subjectType: "post_lock_adjustment", subjectId: id, round: 1, memberId: actor, decision: "approve", now: ctx.now, label: "adjustment" });
    audit(tx, ctx, "post_lock.request", "post_lock_adjustment", id, p.id, undefined, input);
    return { adjustmentId: id };
  });
}

export function approvePostLockAdjustment(ctx: Ctx, adjustmentId: number): { applied: boolean; snapshotId?: number } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const a = tx.select().from(postLockAdjustments).where(eq(postLockAdjustments.id, adjustmentId)).get();
    if (!a) throw new DomainError("not_found", "Adjustment not found");
    assertProjectMember(tx, a.projectId, actor);
    if (a.status !== "requested") throw new DomainError("conflict", "This adjustment was already decided");
    castVote(tx, { subjectType: "post_lock_adjustment", subjectId: a.id, round: a.round, memberId: actor, decision: "approve", now: ctx.now, label: "adjustment" });
    audit(tx, ctx, "post_lock.approve", "post_lock_adjustment", a.id, a.projectId, undefined, undefined);
    const p = loadProject(tx, a.projectId);
    if (!allApproved(tx, "post_lock_adjustment", a.id, a.round, projectMemberIds(tx, p.id))) return { applied: false };

    const prev = latestSnapshot(tx, p.id, "locked");
    if (!prev) throw new DomainError("conflict", "No locked snapshot to adjust");
    const prevInputs = prev.inputs as CalcInput;
    const params = prev.params as CalcParams;
    const nextInputs: CalcInput = {
      ...prevInputs,
      revenuePaise: prevInputs.revenuePaise + a.payload.revenueDeltaPaise,
      expenses: [
        ...prevInputs.expenses,
        ...a.payload.expenses.map((e, i) => ({ ref: `adj:${a.id}:expense:${i}`, amountPaise: e.amountPaise, paidBy: e.paidBy === null ? null : String(e.paidBy), reimbursable: e.paidBy !== null })),
      ],
      pointAdjustments: [...(prevInputs.pointAdjustments ?? []), ...a.payload.points.map((pt, i) => ({ ref: `adj:${a.id}:points:${i}`, memberId: String(pt.memberId), points: pt.points }))],
    };
    if (nextInputs.revenuePaise < 0) throw new DomainError("invalid", "Revenue cannot go below zero");
    const outputs = calculateContribution(nextInputs, params);
    const hash = snapshotHash({ calcVersion: CALC_VERSION, configVersionId: prev.configVersionId, inputs: nextInputs, params, outputs });
    const now = iso(ctx.now);
    const snapId = tx
      .insert(contributionSnapshots)
      .values({
        projectId: p.id,
        kind: "adjustment",
        seq: (latestSnapshot(tx, p.id)?.seq ?? 0) + 1,
        period: a.period,
        status: "locked",
        inputs: nextInputs,
        params,
        outputs,
        hash,
        calcVersion: CALC_VERSION,
        configVersionId: prev.configVersionId,
        previousSnapshotId: prev.id,
        postLockAdjustmentId: a.id,
        createdBy: actor,
        createdAt: now,
        lockedAt: now,
      })
      .returning()
      .get();
    writeDistributions(tx, snapId, outputs, prev.outputs as CalcResult);
    const reserveDelta = outputs.reservePaise - (prev.outputs as CalcResult).reservePaise;
    if (reserveDelta !== 0) {
      tx.insert(reserveLedger)
        .values({ entryDate: isoDate(ctx.now), projectId: p.id, amount: Math.abs(reserveDelta), direction: reserveDelta > 0 ? "in" : "out", purpose: `Post-lock adjustment #${a.id}: ${a.reason}`, snapshotId: snapId.id, status: "approved", createdBy: actor, createdAt: now })
        .run();
    }
    tx.update(postLockAdjustments).set({ status: "approved", decidedAt: now, snapshotId: snapId.id }).where(eq(postLockAdjustments.id, a.id)).run();
    audit(tx, ctx, "post_lock.apply", "snapshot", snapId.id, p.id, { previousSnapshot: prev.id }, { hash, payouts: outputs.members.map((m) => ({ member: m.memberId, payout: m.payoutPaise })) });
    return { applied: true, snapshotId: snapId.id };
  });
}

export function rejectPostLockAdjustment(ctx: Ctx, adjustmentId: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const a = tx.select().from(postLockAdjustments).where(eq(postLockAdjustments.id, adjustmentId)).get();
    if (!a) throw new DomainError("not_found", "Adjustment not found");
    assertProjectMember(tx, a.projectId, actor);
    if (a.status !== "requested") throw new DomainError("conflict", "This adjustment was already decided");
    tx.update(postLockAdjustments).set({ status: "rejected", decidedAt: iso(ctx.now) }).where(eq(postLockAdjustments.id, a.id)).run();
    audit(tx, ctx, "post_lock.reject", "post_lock_adjustment", a.id, a.projectId, { status: "requested" }, { status: "rejected", reason: why });
  });
}
