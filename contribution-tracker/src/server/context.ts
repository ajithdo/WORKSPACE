import type { AppDb } from "@/db";

/** Everything a service needs: the database, who is acting, and the clock (injected for tests). */
export interface Ctx {
  db: AppDb;
  actorId: number | null;
  now: Date;
}

export const iso = (d: Date) => d.toISOString();
/** Calendar date in India (UTC+05:30, no daylight saving): invoice dates and financial years follow IST, not the server clock. */
export const isoDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
