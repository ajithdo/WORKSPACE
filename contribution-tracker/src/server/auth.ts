import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { AppDb } from "@/db";
import { members, sessions, studio } from "@/db/schema";
import { appendAudit } from "./audit";
import type { Ctx } from "./context";
import { addDays, iso } from "./context";
import { requireActor } from "./common";
import { DomainError } from "./errors";
import { importSeedLibrary } from "./seedImport";

const SESSION_DAYS = 30;
const MIN_PASSWORD = 10;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

export type MemberRow = Omit<typeof members.$inferSelect, "passwordHash">;

function scryptCost(): number {
  const n = Number(process.env.SCRYPT_N ?? 32768);
  return Number.isInteger(n) && n >= 1024 ? n : 32768;
}

export function hashPassword(password: string): string {
  const N = scryptCost();
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function checkPasswordStrength(password: string) {
  if (password.length < MIN_PASSWORD) throw new DomainError("invalid", `Passwords must be at least ${MIN_PASSWORD} characters`);
}

const normEmail = (e: string) => e.trim().toLowerCase();
const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SetupInput {
  studio: { name: string; stateCode: string; gstRegistered: boolean; msmeRegistered: boolean; legalName?: string; gstin?: string; address?: string; udyamNumber?: string };
  members: { name: string; email: string; password: string; roles: string[] }[];
}

/** First run only: creates the studio, the partners, and imports the task library and config. */
export function setupStudio(db: AppDb, now: Date, input: SetupInput): { memberIds: number[] } {
  if (db.select({ id: members.id }).from(members).limit(1).get()) throw new DomainError("conflict", "The studio is already set up");
  if (!input.studio.name.trim()) throw new DomainError("invalid", "Studio name is required");
  if (input.members.length < 2) throw new DomainError("invalid", "Add at least two partners: every piece of work is verified by someone else");
  const emails = input.members.map((m) => normEmail(m.email));
  if (new Set(emails).size !== emails.length) throw new DomainError("invalid", "Each partner needs a different email address");
  for (const m of input.members) {
    if (!m.name.trim()) throw new DomainError("invalid", "Every partner needs a name");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(m.email))) throw new DomainError("invalid", `"${m.email}" is not a valid email`);
    checkPasswordStrength(m.password);
  }
  const at = iso(now);
  const memberIds = db.transaction((tx) => {
    tx.insert(studio)
      .values({
        id: 1,
        name: input.studio.name.trim(),
        legalName: input.studio.legalName?.trim() ?? "",
        gstin: input.studio.gstin?.trim().toUpperCase() ?? "",
        stateCode: input.studio.stateCode.trim(),
        gstRegistered: input.studio.gstRegistered,
        msmeRegistered: input.studio.msmeRegistered,
        udyamNumber: input.studio.udyamNumber?.trim() ?? "",
        address: input.studio.address?.trim() ?? "",
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const ids = input.members.map(
      (m) =>
        tx
          .insert(members)
          .values({ name: m.name.trim(), email: normEmail(m.email), passwordHash: hashPassword(m.password), roles: m.roles, createdAt: at })
          .returning({ id: members.id })
          .get().id,
    );
    appendAudit(tx, { at, actorMemberId: ids[0] ?? null, action: "studio.setup", entityType: "studio", entityId: 1, after: { studio: input.studio.name, members: input.members.map((m) => m.name) } });
    return ids;
  });
  importSeedLibrary({ db, actorId: memberIds[0] ?? null, now });
  return { memberIds };
}

export function isSetUp(db: AppDb): boolean {
  return !!db.select({ id: members.id }).from(members).limit(1).get();
}

const failures = new WeakMap<AppDb, Map<string, number[]>>();

function recentFailures(db: AppDb, key: string, now: number): number[] {
  let byKey = failures.get(db);
  if (!byKey) {
    byKey = new Map();
    failures.set(db, byKey);
  }
  const list = (byKey.get(key) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  byKey.set(key, list);
  return list;
}

const DUMMY_HASH = `scrypt$1024$8$1$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`;

export function login(db: AppDb, now: Date, input: { email: string; password: string; ip: string; userAgent?: string }): { token: string; memberId: number; expiresAt: string } {
  const email = normEmail(input.email);
  const nowMs = now.getTime();
  const key = `${email}|${input.ip}`;
  const keyFailures = recentFailures(db, key, nowMs);
  const emailFailures = recentFailures(db, email, nowMs);
  if (keyFailures.length >= MAX_FAILURES || emailFailures.length >= MAX_FAILURES * 4) {
    const wait = Math.ceil((FAILURE_WINDOW_MS - (nowMs - (keyFailures[0] ?? emailFailures[0] ?? nowMs))) / 60_000);
    throw new DomainError("forbidden", `Too many failed attempts. Try again in ${Math.max(1, wait)} minutes.`);
  }
  const m = db.select().from(members).where(eq(members.email, email)).get();
  const ok = m ? verifyPassword(input.password, m.passwordHash) : verifyPassword(input.password, DUMMY_HASH) && false;
  if (!m || !ok || !m.active) {
    keyFailures.push(nowMs);
    emailFailures.push(nowMs);
    throw new DomainError("unauthenticated", "Wrong email or password");
  }
  failures.get(db)?.delete(key);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = iso(addDays(now, SESSION_DAYS));
  db.insert(sessions)
    .values({ id: tokenId(token), memberId: m.id, createdAt: iso(now), expiresAt, lastSeenAt: iso(now), userAgent: input.userAgent?.slice(0, 200) ?? null })
    .run();
  return { token, memberId: m.id, expiresAt };
}

export function memberForSession(db: AppDb, now: Date, token: string | undefined | null): MemberRow | null {
  if (!token) return null;
  const s = db.select().from(sessions).where(eq(sessions.id, tokenId(token))).get();
  if (!s) return null;
  if (s.expiresAt <= iso(now)) {
    db.delete(sessions).where(eq(sessions.id, s.id)).run();
    return null;
  }
  const m = db.select().from(members).where(eq(members.id, s.memberId)).get();
  if (!m || !m.active) return null;
  if (now.getTime() - Date.parse(s.lastSeenAt) > 86_400_000) {
    db.update(sessions)
      .set({ lastSeenAt: iso(now), expiresAt: iso(addDays(now, SESSION_DAYS)) })
      .where(eq(sessions.id, s.id))
      .run();
  }
  const { passwordHash: _omit, ...rest } = m;
  return rest;
}

export function logout(db: AppDb, token: string | undefined | null) {
  if (token) db.delete(sessions).where(eq(sessions.id, tokenId(token))).run();
}

export function changePassword(ctx: Ctx, input: { current: string; next: string }) {
  const actor = requireActor(ctx);
  const m = ctx.db.select().from(members).where(eq(members.id, actor)).get();
  if (!m || !verifyPassword(input.current, m.passwordHash)) throw new DomainError("invalid", "Current password is not correct");
  checkPasswordStrength(input.next);
  ctx.db.transaction((tx) => {
    tx.update(members).set({ passwordHash: hashPassword(input.next), mustChangePassword: false }).where(eq(members.id, actor)).run();
    appendAudit(tx, { at: iso(ctx.now), actorMemberId: actor, action: "member.change_password", entityType: "member", entityId: actor });
  });
}

/**
 * Server-side recovery for a forgotten password (there is no email). Sets a one-time password the
 * member must change after signing in, and signs them out everywhere.
 */
export function resetPassword(db: AppDb, now: Date, email: string): { name: string; temporaryPassword: string } {
  const m = db.select().from(members).where(eq(members.email, normEmail(email))).get();
  if (!m) throw new DomainError("not_found", `No member with email ${email}`);
  const temporaryPassword = randomBytes(12).toString("base64url");
  db.transaction((tx) => {
    tx.update(members).set({ passwordHash: hashPassword(temporaryPassword), mustChangePassword: true }).where(eq(members.id, m.id)).run();
    tx.delete(sessions).where(eq(sessions.memberId, m.id)).run();
    appendAudit(tx, { at: iso(now), actorMemberId: null, action: "member.password_reset", entityType: "member", entityId: m.id });
  });
  return { name: m.name, temporaryPassword };
}

export function addMember(ctx: Ctx, input: { name: string; email: string; password: string; roles: string[] }): { memberId: number } {
  const actor = requireActor(ctx);
  const email = normEmail(input.email);
  if (!input.name.trim()) throw new DomainError("invalid", "Name is required");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError("invalid", "Enter a valid email");
  checkPasswordStrength(input.password);
  return ctx.db.transaction((tx) => {
    if (tx.select({ id: members.id }).from(members).where(sql`lower(${members.email}) = ${email}`).get()) {
      throw new DomainError("conflict", "A member with this email already exists");
    }
    const id = tx
      .insert(members)
      .values({ name: input.name.trim(), email, passwordHash: hashPassword(input.password), roles: input.roles, mustChangePassword: true, createdAt: iso(ctx.now) })
      .returning({ id: members.id })
      .get().id;
    appendAudit(tx, { at: iso(ctx.now), actorMemberId: actor, action: "member.add", entityType: "member", entityId: id, after: { name: input.name, email, roles: input.roles } });
    return { memberId: id };
  });
}

export function updateMember(ctx: Ctx, memberId: number, patch: { name?: string; roles?: string[]; active?: boolean }) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const before = tx.select().from(members).where(eq(members.id, memberId)).get();
    if (!before) throw new DomainError("not_found", "Member not found");
    if (patch.active === false && memberId === actor) throw new DomainError("invalid", "You cannot deactivate yourself");
    const next = {
      name: patch.name?.trim() || before.name,
      roles: patch.roles ?? before.roles,
      active: patch.active ?? before.active,
    };
    tx.update(members).set(next).where(eq(members.id, memberId)).run();
    if (next.active === false) tx.delete(sessions).where(eq(sessions.memberId, memberId)).run();
    appendAudit(tx, {
      at: iso(ctx.now),
      actorMemberId: actor,
      action: "member.update",
      entityType: "member",
      entityId: memberId,
      before: { name: before.name, roles: before.roles, active: before.active },
      after: next,
    });
  });
}

export function listMembers(db: AppDb): MemberRow[] {
  return db
    .select()
    .from(members)
    .all()
    .map(({ passwordHash: _omit, ...rest }) => rest);
}
