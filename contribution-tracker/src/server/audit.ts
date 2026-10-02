import { asc, desc } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "@/domain/canonical";
import type { AppDb, DbOrTx } from "@/db";
import { auditLog, members } from "@/db/schema";
import { eq } from "drizzle-orm";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  at: string;
  actorMemberId: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  projectId?: number | null;
  before?: unknown;
  after?: unknown;
}

function entryPayload(e: {
  id: number;
  at: string;
  actorMemberId: number | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  projectId: number | null;
  before: string | null;
  after: string | null;
}) {
  return canonicalJson(e);
}

/** Appends one entry: hash = sha256(prev_hash + canonical_json(entry)). Call inside the write's transaction. */
export function appendAudit(tx: DbOrTx, input: AuditInput) {
  const last = tx.select({ id: auditLog.id, hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.id)).limit(1).get();
  const id = (last?.id ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const actorLabel =
    input.actorMemberId === null
      ? "system"
      : (tx.select({ name: members.name }).from(members).where(eq(members.id, input.actorMemberId)).get()?.name ?? `member #${input.actorMemberId}`);
  const row = {
    id,
    at: input.at,
    actorMemberId: input.actorMemberId,
    actorLabel,
    action: input.action,
    entityType: input.entityType,
    entityId: String(input.entityId),
    projectId: input.projectId ?? null,
    before: input.before === undefined ? null : canonicalJson(input.before),
    after: input.after === undefined ? null : canonicalJson(input.after),
  };
  const hash = sha256Hex(prevHash + entryPayload(row));
  tx.insert(auditLog).values({ ...row, prevHash, hash }).run();
  return { ...row, prevHash, hash };
}

export interface ChainCheck {
  ok: boolean;
  count: number;
  firstBrokenId?: number;
  reason?: string;
}

/** Re-walks the whole chain. Detects edited, deleted, inserted or reordered entries. */
export function verifyAuditChain(db: AppDb): ChainCheck {
  const rows = db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  let prev = GENESIS_HASH;
  let expectedId = 1;
  for (const r of rows) {
    if (r.id !== expectedId) return { ok: false, count: rows.length, firstBrokenId: r.id, reason: `entry ${expectedId} is missing` };
    if (r.prevHash !== prev) return { ok: false, count: rows.length, firstBrokenId: r.id, reason: "previous-hash link does not match" };
    const { prevHash: _p, hash, ...rest } = r;
    if (sha256Hex(prev + entryPayload(rest)) !== hash) return { ok: false, count: rows.length, firstBrokenId: r.id, reason: "entry content does not match its hash" };
    prev = hash;
    expectedId += 1;
  }
  return { ok: true, count: rows.length };
}
