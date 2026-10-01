process.env.SCRYPT_N = "1024";
import { openDb, type AppDb } from "@/db";
import { members } from "@/db/schema";
import type { Ctx } from "@/server/context";

export const T0 = new Date("2026-10-01T09:00:00.000Z");

export function testDb(): AppDb {
  return openDb(":memory:");
}

export function ctxFor(db: AppDb, actorId: number | null, now: Date = T0): Ctx {
  return { db, actorId, now };
}

/** Inserts members directly (auth is tested separately). */
export function addMembers(db: AppDb, names: string[] = ["Asha", "Bala"]): number[] {
  return names.map(
    (name, i) =>
      db
        .insert(members)
        .values({ name, email: `${name.toLowerCase()}@studio.test`, passwordHash: "x", roles: i === 0 ? ["FE", "Design", "Content"] : ["BE", "DevOps", "PM", "Sales", "QA"], createdAt: T0.toISOString() })
        .returning({ id: members.id })
        .get().id,
  );
}
