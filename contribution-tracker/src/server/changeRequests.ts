import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { changeRequests, evidence } from "@/db/schema";
import { and } from "drizzle-orm";
import type { Ctx } from "./context";
import { iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, loadProject, nonEmpty, projectConfig, requireActor } from "./common";
import { DomainError } from "./errors";
import { createInvoice } from "./finance";
import { insertCustomTask, type CustomTaskInput } from "./plan";

export type ChangeRequestRow = typeof changeRequests.$inferSelect;

function loadCr(tx: DbOrTx, id: number): ChangeRequestRow {
  const c = tx.select().from(changeRequests).where(eq(changeRequests.id, id)).get();
  if (!c) throw new DomainError("not_found", "Change request not found");
  return c;
}

function setStatus(tx: DbOrTx, ctx: Ctx, c: ChangeRequestRow, status: string, extra: Partial<typeof changeRequests.$inferInsert> = {}) {
  tx.update(changeRequests)
    .set({ status, updatedAt: iso(ctx.now), ...extra })
    .where(eq(changeRequests.id, c.id))
    .run();
  audit(tx, ctx, `change_request.${status}`, "change_request", c.id, c.projectId, { status: c.status }, { status, ...extra });
}

export function logChangeRequest(
  ctx: Ctx,
  projectId: number,
  input: { description: string; requestedByClientName: string; requestedAt: string; classification?: "bug" | "revision" | "change" },
): { changeRequestId: number; number: string } {
  const actor = requireActor(ctx);
  const description = nonEmpty(input.description, "What the client asked for");
  return ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    const last = tx.select({ n: changeRequests.number }).from(changeRequests).where(eq(changeRequests.projectId, p.id)).orderBy(desc(changeRequests.id)).get();
    const number = `CR-${String((last ? Number(last.n.split("-")[1]) : 0) + 1).padStart(3, "0")}`;
    const now = iso(ctx.now);
    const id = tx
      .insert(changeRequests)
      .values({ projectId: p.id, number, description, requestedByClientName: input.requestedByClientName.trim(), requestedAt: input.requestedAt, classification: input.classification ?? "change", status: "logged", createdBy: actor, createdAt: now, updatedAt: now })
      .returning({ id: changeRequests.id })
      .get().id;
    audit(tx, ctx, "change_request.log", "change_request", id, p.id, undefined, { number, ...input });
    return { changeRequestId: id, number };
  });
}

export function assessChangeRequest(
  ctx: Ctx,
  id: number,
  input: { classification: "bug" | "revision" | "change"; estimateHours: number; priceExGst: number; timelineImpactDays: number; noCharge: boolean },
) {
  const actor = requireActor(ctx);
  if (!(input.estimateHours >= 0)) throw new DomainError("invalid", "Estimate must be zero or more hours");
  if (!Number.isSafeInteger(input.priceExGst) || input.priceExGst < 0) throw new DomainError("invalid", "Price must be zero or more");
  ctx.db.transaction((tx) => {
    const c = loadCr(tx, id);
    const p = loadProject(tx, c.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (!["logged", "assessed"].includes(c.status)) throw new DomainError("conflict", "This change request is past assessment");
    const free = input.classification !== "change" || input.noCharge;
    setStatus(tx, ctx, c, "assessed", { ...input, priceExGst: free ? 0 : input.priceExGst, assessedBy: actor });
  });
}

export function advanceChangeRequest(ctx: Ctx, id: number, to: "quoted" | "approved" | "declined" | "done", note?: string) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const c = loadCr(tx, id);
    const p = loadProject(tx, c.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    const allowed: Record<string, string[]> = { quoted: ["assessed"], approved: ["quoted", "assessed"], declined: ["logged", "assessed", "quoted"], done: ["approved"] };
    if (!allowed[to]?.includes(c.status)) throw new DomainError("conflict", `Cannot move from ${c.status} to ${to}`);
    if (to === "approved" && c.classification === "change") {
      // "No approval, no work": the client's approval must be on record.
      const approval = tx
        .select()
        .from(evidence)
        .where(and(eq(evidence.subjectType, "change_request"), eq(evidence.subjectId, c.id)))
        .all()
        .find((e) => ["client_approval", "email_sent", "signed_document"].includes(e.type) && e.verificationStatus !== "rejected");
      if (!approval) throw new DomainError("conflict", "Attach the client's written approval (email or signed document) before marking it approved");
      setStatus(tx, ctx, c, "approved", { approvalEvidenceId: approval.id });
      return;
    }
    setStatus(tx, ctx, c, to, to === "declined" ? { declineReason: note?.trim() || null } : {});
  });
}

export function addChangeRequestTask(ctx: Ctx, id: number, input: CustomTaskInput): { taskId: number; code: string } {
  return ctx.db.transaction((tx) => {
    const c = loadCr(tx, id);
    const p = loadProject(tx, c.projectId);
    assertProjectOpen(p);
    if (!["approved", "assessed", "quoted"].includes(c.status)) throw new DomainError("conflict", "Add work once the change is assessed");
    return insertCustomTask(tx, ctx, p, { ...input, origin: "change_request", changeRequestId: c.id });
  });
}

export function invoiceChangeRequest(ctx: Ctx, id: number, input: { issueDate: string; dueDate: string }): { invoiceId: number } {
  const actor = requireActor(ctx);
  const c = ctx.db.transaction((tx) => loadCr(tx, id));
  if (!["approved", "done"].includes(c.status)) throw new DomainError("conflict", "Only approved change requests can be invoiced");
  if (c.priceExGst <= 0) throw new DomainError("conflict", "This change has no charge");
  const { invoiceId } = createInvoice(ctx, c.projectId, { type: "change_request", issueDate: input.issueDate, dueDate: input.dueDate, amountExGst: c.priceExGst, changeRequestId: c.id, notes: `${c.number}: ${c.description}` });
  ctx.db.transaction((tx) => {
    const fresh = loadCr(tx, id);
    setStatus(tx, { ...ctx, actorId: actor }, fresh, "invoiced", { invoiceId });
    void projectConfig;
  });
  return { invoiceId };
}
