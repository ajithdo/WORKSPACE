"use server";

import { getDb } from "@/db";
import { runAction, type ActionState } from "@/lib/actions";
import { verifyAuditChain } from "@/server/audit";
import { DomainError } from "@/server/errors";

export async function verifyChainAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  let message = "";
  const r = await runAction(() => {
    const check = verifyAuditChain(getDb());
    if (!check.ok) throw new DomainError("conflict", `Integrity check FAILED at entry ${check.firstBrokenId}: ${check.reason}. Someone changed the database outside the app.`);
    message = `All ${check.count} entries check out: the chain is unbroken.`;
  });
  return r?.ok ? { ...r, message } : r;
}
