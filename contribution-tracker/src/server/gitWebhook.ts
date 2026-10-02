import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "@/db";
import { evidence, members, projectMembers, projects, taskInstances } from "@/db/schema";
import { DomainError } from "./errors";
import { addEvidence } from "./evidence";

/** GitHub signs each delivery with HMAC-SHA256 of the raw body ("X-Hub-Signature-256: sha256=<hex>"). */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Task codes as written in commit messages: "V-09", "AI-05", custom "V-X01". */
const TASK_CODE = /\b([A-Z]{1,2}-[A-Z]?\d{2,3})\b/g;

interface PushCommit {
  id?: string;
  message?: string;
  url?: string;
  distinct?: boolean;
  author?: { email?: string };
}

export interface IngestResult {
  added: { commit: string; task: string }[];
  skipped: { commit: string; reason: string }[];
}

/**
 * Turns pushed commits that name a task code into git_commit evidence on that task, credited to the
 * project member whose email matches the commit author. Nothing is submitted or verified: the
 * partner still submits, and the other partner still checks.
 */
export function ingestGithubPush(db: AppDb, now: Date, projectCode: string, payload: { commits?: PushCommit[] }): IngestResult {
  const p = db.select().from(projects).where(eq(projects.code, projectCode)).get();
  if (!p) throw new DomainError("not_found", "Unknown project");
  const team = db
    .select({ id: members.id, email: members.email })
    .from(members)
    .innerJoin(projectMembers, and(eq(projectMembers.memberId, members.id), eq(projectMembers.projectId, p.id), eq(projectMembers.active, true)))
    .all();
  const byEmail = new Map(team.map((m) => [m.email.toLowerCase(), m.id]));
  const tasks = new Map(
    db
      .select()
      .from(taskInstances)
      .where(eq(taskInstances.projectId, p.id))
      .all()
      .filter((t) => t.status !== "cancelled" && t.status !== "locked")
      .map((t) => [t.code, t]),
  );
  const result: IngestResult = { added: [], skipped: [] };
  for (const c of (payload.commits ?? []).slice(0, 100)) {
    const sha = (c.id ?? "").slice(0, 40);
    const message = (c.message ?? "").trim();
    if (!sha || !message || c.distinct === false) continue;
    const codes = [...new Set([...message.matchAll(TASK_CODE)].map((m) => m[1]!))].filter((code) => tasks.has(code));
    if (!codes.length) continue;
    const memberId = byEmail.get((c.author?.email ?? "").toLowerCase());
    if (!memberId) {
      result.skipped.push({ commit: sha.slice(0, 7), reason: `author ${c.author?.email ?? "unknown"} is not a partner on ${p.code}` });
      continue;
    }
    const firstLine = message.split("\n")[0]!.trim();
    const description = (firstLine.length >= 10 ? firstLine : `Commit: ${firstLine} (${sha.slice(0, 7)})`).slice(0, 300);
    for (const code of codes) {
      const t = tasks.get(code)!;
      const dup = db
        .select({ n: sql<number>`count(*)` })
        .from(evidence)
        .where(and(eq(evidence.subjectType, "task"), eq(evidence.subjectId, t.id), eq(evidence.externalRef, sha)))
        .get();
      if (dup?.n) continue;
      try {
        addEvidence(
          { db, actorId: memberId, now },
          {
            subjectType: "task",
            subjectId: t.id,
            type: "git_commit",
            externalRef: sha,
            url: c.url && /^https:\/\/[^\s]+$/.test(c.url) ? c.url : null,
            description,
            containsPersonalData: false,
            redacted: false,
            noSecretsConfirmed: true,
          },
        );
        result.added.push({ commit: sha.slice(0, 7), task: code });
      } catch (e) {
        result.skipped.push({ commit: sha.slice(0, 7), reason: e instanceof DomainError ? e.message : "could not be added" });
      }
    }
  }
  return result;
}
