import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { studio } from "@/db/schema";
import type { Ctx } from "./context";
import { iso } from "./context";
import { audit, requireActor } from "./common";
import { DomainError } from "./errors";

export function getStudio(db: AppDb) {
  return db.select().from(studio).where(eq(studio.id, 1)).get() ?? null;
}

export function updateStudio(
  ctx: Ctx,
  patch: Partial<{ name: string; legalName: string; gstin: string; stateCode: string; gstRegistered: boolean; msmeRegistered: boolean; udyamNumber: string; address: string; invoicePrefix: string }>,
) {
  requireActor(ctx);
  ctx.db.transaction((tx) => {
    const before = tx.select().from(studio).where(eq(studio.id, 1)).get();
    if (!before) throw new DomainError("conflict", "Set up the studio first");
    if (patch.invoicePrefix !== undefined && !/^[A-Za-z0-9-]{1,6}$/.test(patch.invoicePrefix)) throw new DomainError("invalid", "Invoice prefix: 1–6 letters, digits or dashes");
    if (patch.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(patch.gstin.toUpperCase())) throw new DomainError("invalid", "GSTIN must be 15 characters starting with the state code");
    const next = { ...patch, gstin: patch.gstin?.toUpperCase() ?? before.gstin, updatedAt: iso(ctx.now) };
    tx.update(studio).set(next).where(eq(studio.id, 1)).run();
    audit(tx, ctx, "studio.update", "studio", 1, null, before, next);
  });
}
