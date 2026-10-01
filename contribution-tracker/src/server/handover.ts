import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { clientApprovals, handoverItems, taskInstances } from "@/db/schema";
import type { Ctx } from "./context";
import { iso, isoDate } from "./context";
import { assertProjectMember, assertProjectOpen, audit, loadProject, projectConfig, requireActor } from "./common";
import { DomainError } from "./errors";

export type HandoverRow = typeof handoverItems.$inferSelect;

/** Whether an AMC is in force: BH-01 verified with the client's written approval. */
export function amcActive(tx: DbOrTx, projectId: number): boolean {
  const t = tx
    .select()
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, projectId), eq(taskInstances.code, "BH-01")))
    .get();
  if (!t || (t.status !== "verified" && t.status !== "locked")) return false;
  const a = tx.select().from(clientApprovals).where(eq(clientApprovals.taskInstanceId, t.id)).get();
  return a?.status === "approved" || a?.status === "deemed_approved";
}

export function itemBlockers(i: HandoverRow, amc: boolean): string[] {
  if (i.status === "not_applicable") return [];
  const out: string[] = [];
  if (i.status !== "verified_by_client") out.push("not yet verified by the client");
  if (i.credentialsExist && !i.credentialsRotated) out.push("credentials not rotated");
  if (i.developerAccess === "retained_with_reason" && !amc) out.push("studio access retained without an active AMC");
  if (!i.developerAccess && i.status === "verified_by_client") out.push("record what happened to studio access");
  return out;
}

/** Spec §13: M10 completes when every applicable item is verified by the client, rotated, and studio access is removed (or reduced for an AMC). */
export function handoverStatus(tx: DbOrTx, projectId: number) {
  const items = tx.select().from(handoverItems).where(eq(handoverItems.projectId, projectId)).all();
  const amc = amcActive(tx, projectId);
  const rows = items.map((i) => ({ ...i, blockers: itemBlockers(i, amc) }));
  const applicable = rows.filter((r) => r.status !== "not_applicable");
  return {
    items: rows,
    applicable: applicable.length,
    done: applicable.filter((r) => r.blockers.length === 0).length,
    complete: rows.every((r) => r.blockers.length === 0),
    amcActive: amc,
  };
}

export interface HandoverPatch {
  status?: string;
  ownerConfirmed?: string;
  credentialsExist?: boolean;
  credentialsRotated?: boolean;
  rotatedOn?: string | null;
  developerAccess?: string | null;
  retainedReason?: string | null;
  notes?: string;
}

export function updateHandoverItem(ctx: Ctx, itemId: number, patch: HandoverPatch) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const item = tx.select().from(handoverItems).where(eq(handoverItems.id, itemId)).get();
    if (!item) throw new DomainError("not_found", "Handover item not found");
    const p = loadProject(tx, item.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    const cfg = projectConfig(tx, p);
    const next = {
      status: patch.status ?? item.status,
      ownerConfirmed: patch.ownerConfirmed?.trim() ?? item.ownerConfirmed,
      credentialsExist: patch.credentialsExist ?? item.credentialsExist,
      credentialsRotated: patch.credentialsRotated ?? item.credentialsRotated,
      rotatedOn: patch.rotatedOn !== undefined ? patch.rotatedOn : item.rotatedOn,
      developerAccess: patch.developerAccess !== undefined ? patch.developerAccess : item.developerAccess,
      retainedReason: patch.retainedReason !== undefined ? patch.retainedReason?.trim() || null : item.retainedReason,
      notes: patch.notes ?? item.notes,
      updatedBy: actor,
      updatedAt: iso(ctx.now),
    };
    if (!cfg.handover_item_status.includes(next.status)) throw new DomainError("invalid", "Unknown handover status");
    if (next.developerAccess && !cfg.developer_access_values.includes(next.developerAccess)) throw new DomainError("invalid", "Unknown developer access value");
    if (next.status === "verified_by_client" && !next.ownerConfirmed) throw new DomainError("invalid", "Record whose account now owns this item before marking it verified by the client");
    if (next.developerAccess === "retained_with_reason" && !next.retainedReason) throw new DomainError("invalid", "Explain why studio access is retained");
    if (next.credentialsRotated && !next.rotatedOn) next.rotatedOn = isoDate(ctx.now);
    tx.update(handoverItems).set(next).where(eq(handoverItems.id, itemId)).run();
    audit(tx, ctx, "handover.update", "handover_item", itemId, p.id, item, next);
  });
}
