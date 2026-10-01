import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { isSetUp, memberForSession, type MemberRow } from "@/server/auth";
import type { Ctx } from "@/server/context";
import { runDueJobsThrottled } from "@/server/jobs";

export const SESSION_COOKIE = "ct_session";

export async function currentMember(): Promise<MemberRow | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return memberForSession(getDb(), new Date(), token);
}

/** For every signed-in page and action: sends people to setup or login, and runs due timers. */
export async function requireMember(): Promise<MemberRow> {
  const db = getDb();
  if (!isSetUp(db)) redirect("/setup");
  const m = await currentMember();
  if (!m) redirect("/login");
  runDueJobsThrottled({ db, actorId: null, now: new Date() });
  return m;
}

export async function requestCtx(): Promise<Ctx & { member: MemberRow }> {
  const member = await requireMember();
  return { db: getDb(), actorId: member.id, now: new Date(), member };
}

export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === "true";
}
