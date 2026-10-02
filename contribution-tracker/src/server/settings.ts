import { eq } from "drizzle-orm";
import { gstinProblem } from "@/domain/gstin";
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

    const gstin = patch.gstin?.toUpperCase() ?? before.gstin;
    const state = patch.stateCode ?? before.stateCode;
    const problem = gstin ? gstinProblem(gstin, state) : null;
    if (problem) throw new DomainError("invalid", problem);
    if (patch.udyamNumber && !/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(patch.udyamNumber.trim().toUpperCase())) {
      throw new DomainError("invalid", "Udyam numbers look like UDYAM-TS-02-0012345");
    }
    if (patch.udyamNumber !== undefined) patch = { ...patch, udyamNumber: patch.udyamNumber.trim().toUpperCase() };
    const next = { ...patch, gstin, updatedAt: iso(ctx.now) };
    tx.update(studio).set(next).where(eq(studio.id, 1)).run();
    audit(tx, ctx, "studio.update", "studio", 1, null, before, next);
  });
}
