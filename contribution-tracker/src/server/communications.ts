import { eq } from "drizzle-orm";
import { verifierEligibility } from "@/domain/taskRules";
import type { DbOrTx } from "@/db";
import { actionItems, communications, taskTemplates } from "@/db/schema";
import { and } from "drizzle-orm";
import type { Ctx } from "./context";
import { iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, loadProject, nonEmpty, projectConfig, projectMemberIds, requireActor } from "./common";
import { DomainError } from "./errors";
import { insertCustomTask } from "./plan";
import { insertTasksFromTemplates } from "./projects";

export type CommunicationRow = typeof communications.$inferSelect;

function loadComm(tx: DbOrTx, id: number): CommunicationRow {
  const c = tx.select().from(communications).where(eq(communications.id, id)).get();
  if (!c) throw new DomainError("not_found", "Communication not found");
  return c;
}

export function planCommunication(
  ctx: Ctx,
  projectId: number,
  input: { type: string; scheduledFor: string; leadMemberId: number; secondMemberId?: number | null; secondRequired?: boolean; channel?: string | null },
): { communicationId: number } {
  const actor = requireActor(ctx);
  return ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    const cfg = projectConfig(tx, p);
    if (!cfg.communication_types.some((c) => c.code === input.type)) throw new DomainError("invalid", "Unknown communication type");
    assertProjectMember(tx, p.id, input.leadMemberId);
    const second = input.secondMemberId ?? null;
    if (second !== null) {
      assertProjectMember(tx, p.id, second);
      if (second === input.leadMemberId) throw new DomainError("invalid", "The second attendee must be a different partner");
    }
    const now = iso(ctx.now);
    const id = tx
      .insert(communications)
      .values({
        projectId: p.id,
        type: input.type,
        status: "planned",
        scheduledFor: input.scheduledFor,
        channel: input.channel ?? null,
        leadMemberId: input.leadMemberId,
        secondMemberId: second,
        secondRequired: second !== null && (input.secondRequired ?? false),
        attendeeMemberIds: [input.leadMemberId, ...(second !== null ? [second] : [])],
        decisions: [],
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: communications.id })
      .get().id;
    audit(tx, ctx, "communication.plan", "communication", id, p.id, undefined, input);
    return { communicationId: id };
  });
}

export interface ActionItemInput {
  text: string;
  ownerMemberId?: number | null;
  dueDate?: string | null;
  templateCode?: string | null;
  categoryCode?: string | null;
  points?: number | null;
}

export interface LogCommunicationInput {
  communicationId?: number;
  projectId?: number;
  type?: string;
  occurredAt: string;
  channel: string;
  durationMinutes?: number | null;
  leadMemberId?: number;
  secondMemberId?: number | null;
  /** Ignored unless the communication was planned with it (decision D3). */
  secondRequired?: boolean;
  attendeeMemberIds?: number[];
  clientAttendees?: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItemInput[];
  notesSentToClient?: boolean;
}

export function logCommunication(ctx: Ctx, input: LogCommunicationInput): { communicationId: number; taskIds: number[] } {
  const actor = requireActor(ctx);
  const summary = nonEmpty(input.summary, "Summary");
  const decisions = input.decisions.map((d) => d.trim()).filter(Boolean);
  return ctx.db.transaction((tx) => {
    let existing: CommunicationRow | null = null;
    let projectId = input.projectId;
    if (input.communicationId) {
      existing = loadComm(tx, input.communicationId);
      if (existing.status !== "planned") throw new DomainError("conflict", "This communication was already logged");
      projectId = existing.projectId;
    }
    if (!projectId) throw new DomainError("invalid", "Project is required");
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    const cfg = projectConfig(tx, p);
    const type = existing?.type ?? input.type ?? "";
    if (!cfg.communication_types.some((c) => c.code === type)) throw new DomainError("invalid", "Unknown communication type");
    if (!cfg.communication_channels.includes(input.channel)) throw new DomainError("invalid", "Unknown channel");
    const lead = existing?.leadMemberId ?? input.leadMemberId ?? actor;
    assertProjectMember(tx, p.id, lead);
    const second = existing ? existing.secondMemberId : (input.secondMemberId ?? null);
    if (second !== null) assertProjectMember(tx, p.id, second);
    const now = iso(ctx.now);
    const values = {
      type,
      status: "logged" as const,
      occurredAt: input.occurredAt,
      channel: input.channel,
      durationMinutes: input.durationMinutes ?? null,
      leadMemberId: lead,
      secondMemberId: second,
      secondRequired: existing ? existing.secondRequired : false,
      attendeeMemberIds: input.attendeeMemberIds ?? [lead, ...(second !== null && second !== lead ? [second] : [])],
      clientAttendees: input.clientAttendees?.trim() ?? "",
      summary,
      decisions,
      notesSentToClient: input.notesSentToClient ?? false,
      loggedBy: actor,
      loggedAt: now,
      updatedAt: now,
    };
    let id: number;
    if (existing) {
      tx.update(communications).set(values).where(eq(communications.id, existing.id)).run();
      id = existing.id;
    } else {
      id = tx
        .insert(communications)
        .values({ projectId: p.id, ...values, createdBy: actor, createdAt: now })
        .returning({ id: communications.id })
        .get().id;
    }
    const taskIds: number[] = [];
    for (const item of input.actionItems) {
      const text = item.text.trim();
      if (!text) continue;
      const owner = item.ownerMemberId ?? lead;
      let taskId: number;
      if (item.templateCode) {
        const tpl = tx
          .select()
          .from(taskTemplates)
          .where(and(eq(taskTemplates.libraryVersionId, p.libraryVersionId), eq(taskTemplates.code, item.templateCode)))
          .get();
        if (!tpl) throw new DomainError("invalid", `Unknown library task ${item.templateCode}`);
        taskId = insertTasksFromTemplates(tx, ctx, p, cfg, [tpl], "proposed")[0] as number;
      } else {
        taskId = insertCustomTask(tx, ctx, p, {
          name: text.slice(0, 200),
          categoryCode: item.categoryCode ?? "K",
          defaultPoints: item.points ?? 1,
          ownerMemberId: owner,
          origin: "action_item",
          communicationId: id,
        }).taskId;
      }
      tx.insert(actionItems).values({ communicationId: id, text, ownerMemberId: owner, dueDate: item.dueDate ?? null, taskInstanceId: taskId, createdAt: now }).run();
      taskIds.push(taskId);
    }
    audit(tx, ctx, "communication.log", "communication", id, p.id, existing ?? undefined, { ...values, actionItems: input.actionItems.length, taskIds });
    return { communicationId: id, taskIds };
  });
}

export function communicationBeneficiaries(c: CommunicationRow): number[] {
  const out = [c.leadMemberId];
  if (c.secondRequired && c.secondMemberId !== null && c.secondMemberId !== c.leadMemberId) out.push(c.secondMemberId);
  return out;
}

export function canVerifyCommunication(tx: DbOrTx, c: CommunicationRow, memberId: number): boolean {
  if (c.status !== "logged") return false;
  const e = verifierEligibility(projectMemberIds(tx, c.projectId), communicationBeneficiaries(c), c.loggedBy ?? c.leadMemberId);
  return e.eligible.includes(memberId);
}

export function verifyCommunication(ctx: Ctx, id: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const c = loadComm(tx, id);
    const p = loadProject(tx, c.projectId);
    assertProjectOpen(p);
    if (c.status !== "logged") throw new DomainError("conflict", "Only logged communications can be verified");
    if (!canVerifyCommunication(tx, c, actor)) throw new DomainError("forbidden", "You cannot verify a communication you logged or earn points from");
    tx.update(communications).set({ status: "verified", verifiedBy: actor, verifiedAt: iso(ctx.now), updatedAt: iso(ctx.now) }).where(eq(communications.id, id)).run();
    audit(tx, ctx, "communication.verify", "communication", id, p.id, { status: "logged" }, { status: "verified" });
  });
}

export function rejectCommunication(ctx: Ctx, id: number, reason: string) {
  const actor = requireActor(ctx);
  const why = nonEmpty(reason, "A reason");
  ctx.db.transaction((tx) => {
    const c = loadComm(tx, id);
    const p = loadProject(tx, c.projectId);
    assertProjectOpen(p);
    if (c.status !== "logged") throw new DomainError("conflict", "Only logged communications can be rejected");
    if (!canVerifyCommunication(tx, c, actor)) throw new DomainError("forbidden", "Only the other partner can reject this communication");
    tx.update(communications).set({ status: "rejected", rejectionReason: why, verifiedBy: actor, verifiedAt: iso(ctx.now), updatedAt: iso(ctx.now) }).where(eq(communications.id, id)).run();
    audit(tx, ctx, "communication.reject", "communication", id, p.id, { status: "logged" }, { status: "rejected", reason: why });
  });
}

export function cancelCommunication(ctx: Ctx, id: number) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const c = loadComm(tx, id);
    const p = loadProject(tx, c.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (c.status !== "planned") throw new DomainError("conflict", "Only planned communications can be cancelled");
    tx.update(communications).set({ status: "cancelled", updatedAt: iso(ctx.now) }).where(eq(communications.id, id)).run();
    audit(tx, ctx, "communication.cancel", "communication", id, p.id, { status: "planned" }, { status: "cancelled" });
  });
}
