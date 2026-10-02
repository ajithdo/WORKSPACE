import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db";
import { clientApprovals, invoices, taskInstances } from "@/db/schema";
import { formatINR } from "@/domain/money";
import { readableDate } from "@/domain/reminders";
import { loadProject } from "./common";
import { isoDate } from "./context";
import { isSettled } from "./finance";
import { projectMilestones } from "./milestones";
import { projectHeader } from "./queries";

/** Internal work the client does not need to read about. */
const INTERNAL_PHASES = new Set(["presales", "studio", "closure"]);
/** Lead qualification and internal closure are studio milestones, not the client's. */
const INTERNAL_MILESTONES = new Set(["M0", "M11"]);

export interface ProgressReport {
  projectName: string;
  clientName: string;
  from: string;
  to: string;
  milestones: { code: string; name: string; done: boolean; at: string | null }[];
  done: { code: string; name: string; at: string }[];
  inProgress: { code: string; name: string }[];
  waitingOnClient: string[];
}

/** What a client-facing weekly update needs, for the period [from, to] (ISO dates, inclusive). */
export function progressReport(db: AppDb, projectId: number, from: string, to: string): ProgressReport {
  const { project: p, client } = projectHeader(db, projectId);
  const tasks = db.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const visible = tasks.filter((t) => !INTERNAL_PHASES.has(t.phase) && !t.isSales && !t.isBusinessLevel && !t.isCommunication);
  const inRange = (d: string | null) => !!d && isoDate(new Date(d)) >= from && isoDate(new Date(d)) <= to;
  const done = visible
    .filter((t) => (t.status === "verified" || t.status === "locked") && inRange(t.verifiedAt))
    .sort((a, b) => (a.verifiedAt ?? "").localeCompare(b.verifiedAt ?? ""))
    .map((t) => ({ code: t.code, name: t.name, at: isoDate(new Date(t.verifiedAt!)) }));
  const inProgress = visible.filter((t) => t.status === "in_progress" || t.status === "submitted").map((t) => ({ code: t.code, name: t.name }));

  const waitingOnClient: string[] = [];
  const ids = tasks.map((t) => t.id);
  const approvals = ids.length ? db.select().from(clientApprovals).where(and(inArray(clientApprovals.taskInstanceId, ids), inArray(clientApprovals.status, ["pending", "changes_requested"]))).all() : [];
  for (const a of approvals) {
    const t = tasks.find((x) => x.id === a.taskInstanceId);
    // Approval rows exist from plan time; only a finished deliverable (or one sent for approval) waits on the client.
    const ready = t && (["submitted", "verified", "locked"].includes(t.status) || !!a.requestedAt);
    if (t && ready) waitingOnClient.push(a.status === "pending" ? `Your approval of: ${t.name}` : `Your feedback is being worked into: ${t.name}`);
  }
  for (const inv of db.select().from(invoices).where(eq(invoices.projectId, projectId)).all()) {
    if (!inv.number || inv.status === "draft" || isSettled(inv)) continue;
    waitingOnClient.push(`Payment of invoice ${inv.number} (${formatINR(inv.total)}), due ${readableDate(inv.msmeDueDate && inv.msmeDueDate < inv.dueDate ? inv.msmeDueDate : inv.dueDate)}`);
  }

  const milestones = p.kind === "client" ? projectMilestones(db, loadProject(db, projectId))
          .filter((m) => !INTERNAL_MILESTONES.has(m.code))
          .map((m) => ({ code: m.code, name: m.name, done: m.state !== "pending", at: m.achievedAt })) : [];
  return { projectName: p.name, clientName: client?.businessName ?? "", from, to, milestones, done, inProgress, waitingOnClient };
}

/** Plain text for WhatsApp or email. */
export function progressText(r: ProgressReport, studioName: string): string {
  const next = r.milestones.find((m) => !m.done);
  const lines = [
    `*${r.projectName}: progress update* (${readableDate(r.from)} to ${readableDate(r.to)})`,
    "",
    r.done.length ? "*Completed*" : "No items were completed in this period.",
    ...r.done.map((d) => `• ${d.name}`),
  ];
  if (r.inProgress.length) lines.push("", "*In progress*", ...r.inProgress.map((t) => `• ${t.name}`));
  if (next) lines.push("", `*Next milestone:* ${next.name}`);
  if (r.waitingOnClient.length) lines.push("", "*Waiting on you*", ...r.waitingOnClient.map((w) => `• ${w}`));
  lines.push("", `${studioName}`);
  return lines.join("\n");
}
