import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { AppDb } from "@/db";
import {
  studio,
  adjustmentRequests,
  communications,
  configVersions,
  contributionSnapshots,
  disputes,
  expenses,
  invoices,
  libraryVersions,
  payments,
  postLockAdjustments,
  projectMembers,
  projects,
  reserveLedger,
  taskInstances,
} from "@/db/schema";
import { formatINR } from "@/domain/money";
import { hasVoted } from "./approvals";

const TDS_CHASE_DAYS = 60;
import { canVerifyCommunication } from "./communications";
import { ACTIVE_DISPUTE } from "./contribution";
import { disputeParties } from "./disputes";
import { overdueOn } from "./finance";
import { canVerifyTask } from "./tasks";

export type InboxKind =
  | "verify_task"
  | "approve_proposal"
  | "approve_plan"
  | "approve_snapshot"
  | "approve_post_lock"
  | "approve_adjustment"
  | "respond_dispute"
  | "verify_communication"
  | "verify_payment"
  | "approve_expense"
  | "approve_reserve"
  | "overdue_invoice"
  | "approve_version"
  | "setup_studio"
  | "tds_certificate";

export interface InboxItem {
  kind: InboxKind;
  projectId: number | null;
  projectName: string;
  title: string;
  detail: string;
  href: string;
  at: string;
}

/** Everything waiting on this member. Every approval in the app waits on "the other partner", so this list is the daily to-do. */
export function inboxFor(db: AppDb, memberId: number, now: Date): InboxItem[] {
  const myProjects = db
    .select({ id: projects.id, name: projects.name, code: projects.code, planStatus: projects.planStatus, planRound: projects.planRound, planSubmittedBy: projects.planSubmittedBy, updatedAt: projects.updatedAt })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, memberId), eq(projectMembers.active, true)))
    .where(ne(projects.closeStatus, "closed_locked"))
    .all();
  const ids = myProjects.map((p) => p.id);
  const name = new Map(myProjects.map((p) => [p.id, `${p.code} · ${p.name}`]));
  const items: InboxItem[] = [];
  const push = (i: Omit<InboxItem, "projectName">) => items.push({ ...i, projectName: i.projectId ? (name.get(i.projectId) ?? "") : "Studio" });

  for (const p of myProjects) {
    if (p.planStatus === "awaiting_partner" && !hasVoted(db, "plan", p.id, p.planRound, memberId)) {
      push({ kind: "approve_plan", projectId: p.id, title: "Review and approve the project plan", detail: "Owners, shares and points lock when every partner approves", href: `/projects/${p.id}/plan`, at: p.updatedAt });
    }
  }
  if (ids.length) {
    for (const t of db.select().from(taskInstances).where(and(inArray(taskInstances.projectId, ids), eq(taskInstances.status, "submitted"))).all()) {
      if (canVerifyTask(db, t, memberId)) push({ kind: "verify_task", projectId: t.projectId, title: `Verify ${t.code} ${t.name}`, detail: "Check the evidence and verify, or send it back", href: `/projects/${t.projectId}/tasks/${t.id}`, at: t.submittedAt ?? t.updatedAt });
    }
    for (const t of db.select().from(taskInstances).where(and(inArray(taskInstances.projectId, ids), eq(taskInstances.status, "proposed"))).all()) {
      if (t.proposedBy !== memberId) {
        push({ kind: "approve_proposal", projectId: t.projectId, title: `New task proposed: ${t.code} ${t.name}`, detail: `Approves itself ${t.autoApproveAt ? `on ${t.autoApproveAt.slice(0, 16).replace("T", " ")} UTC` : "soon"} unless you object`, href: `/projects/${t.projectId}/tasks/${t.id}`, at: t.proposedAt ?? t.createdAt });
      }
    }
    for (const s of db.select().from(contributionSnapshots).where(and(inArray(contributionSnapshots.projectId, ids), eq(contributionSnapshots.status, "awaiting_partner"))).all()) {
      if (!hasVoted(db, "snapshot", s.id, s.round, memberId)) push({ kind: "approve_snapshot", projectId: s.projectId, title: "Approve the closing contribution snapshot", detail: `Hash ${s.hash.slice(0, 12)}…`, href: `/projects/${s.projectId}/closure`, at: s.createdAt });
    }
    for (const a of db.select().from(adjustmentRequests).where(and(inArray(adjustmentRequests.projectId, ids), eq(adjustmentRequests.status, "requested"))).all()) {
      if (a.requestedBy !== memberId) push({ kind: "approve_adjustment", projectId: a.projectId, title: `Adjustment requested (${a.kind})`, detail: a.reason, href: `/projects/${a.projectId}/tasks/${a.taskInstanceId}`, at: a.requestedAt });
    }
    for (const d of db.select().from(disputes).where(and(inArray(disputes.projectId, ids), inArray(disputes.status, [...ACTIVE_DISPUTE]))).all()) {
      if (!disputeParties(db, d).includes(memberId)) continue;
      const waitingOnMe = (d.proposedBy && d.proposedBy !== memberId) || (!d.proposedBy && d.raisedBy !== memberId);
      if (waitingOnMe) push({ kind: "respond_dispute", projectId: d.projectId, title: d.proposedBy ? "A dispute resolution was proposed" : "A dispute was raised", detail: d.description, href: `/projects/${d.projectId}/disputes#d${d.id}`, at: d.proposedAt ?? d.raisedAt });
    }
    for (const c of db.select().from(communications).where(and(inArray(communications.projectId, ids), eq(communications.status, "logged"))).all()) {
      if (canVerifyCommunication(db, c, memberId)) push({ kind: "verify_communication", projectId: c.projectId, title: `Verify ${c.type.replaceAll("_", " ")}`, detail: c.summary.slice(0, 120), href: `/projects/${c.projectId}/communications#c${c.id}`, at: c.loggedAt ?? c.updatedAt });
    }
    for (const pay of db.select().from(payments).where(and(inArray(payments.projectId, ids), isNull(payments.verifiedBy))).all()) {
      if (pay.recordedBy !== memberId) push({ kind: "verify_payment", projectId: pay.projectId, title: "Check a payment against the bank statement", detail: `Ref ${pay.bankReference}`, href: `/projects/${pay.projectId}/finance`, at: pay.recordedAt });
    }
    const today = now.toISOString().slice(0, 10);
    for (const inv of db.select().from(invoices).where(inArray(invoices.projectId, ids)).all()) {
      if (overdueOn(inv, today)) push({ kind: "overdue_invoice", projectId: inv.projectId, title: `Invoice ${inv.number} is overdue`, detail: `Due ${inv.msmeDueDate ?? inv.dueDate}`, href: `/projects/${inv.projectId}/finance`, at: inv.dueDate });
    }
  }
  for (const e of db.select().from(expenses).where(eq(expenses.status, "pending")).all()) {
    if (e.createdBy === memberId || e.paidByMemberId === memberId) continue;
    if (e.projectId !== null && !ids.includes(e.projectId)) continue;
    push({ kind: "approve_expense", projectId: e.projectId, title: `Approve expense: ${e.vendor}`, detail: e.description, href: e.projectId ? `/projects/${e.projectId}/finance` : "/settings", at: e.createdAt });
  }
  for (const r of db.select().from(reserveLedger).where(eq(reserveLedger.status, "pending")).all()) {
    if (r.createdBy !== memberId) push({ kind: "approve_reserve", projectId: r.projectId, title: "Approve a release from the reserve", detail: r.purpose, href: "/settings#reserve", at: r.createdAt });
  }
  for (const a of db.select().from(postLockAdjustments).where(eq(postLockAdjustments.status, "requested")).all()) {
    if (!hasVoted(db, "post_lock_adjustment", a.id, a.round, memberId)) push({ kind: "approve_post_lock", projectId: a.projectId, title: "Approve a post-lock adjustment", detail: a.reason, href: `/projects/${a.projectId}/closure`, at: a.requestedAt });
  }
  for (const v of db.select().from(libraryVersions).where(eq(libraryVersions.status, "pending")).all()) {
    if (!hasVoted(db, "library_version", v.id, v.round, memberId)) push({ kind: "approve_version", projectId: null, title: `Approve task library v${v.version}`, detail: v.note, href: "/library", at: v.createdAt });
  }
  for (const v of db.select().from(configVersions).where(eq(configVersions.status, "pending")).all()) {
    if (!hasVoted(db, "config_version", v.id, v.round, memberId)) push({ kind: "approve_version", projectId: null, title: `Approve rules v${v.version}`, detail: v.note, href: "/settings", at: v.createdAt });
  }
  // Form 16A arrives quarterly; chase it once two months have passed, or the TDS credit is lost.
  const chaseBefore = new Date(now.getTime() - TDS_CHASE_DAYS * 86_400_000).toISOString().slice(0, 10);
  // Includes closed projects: the certificate can still be recorded after closure.
  const allMine = db
    .select({ id: projects.id, name: projects.name, code: projects.code })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, memberId), eq(projectMembers.active, true)))
    .all();
  for (const p of allMine) if (!name.has(p.id)) name.set(p.id, `${p.code} · ${p.name}`);
  for (const pay of db.select().from(payments).where(and(inArray(payments.projectId, allMine.map((p) => p.id)), eq(payments.tdsCertificateStatus, "pending"))).all()) {
    if (pay.tdsDeducted > 0 && pay.receivedDate <= chaseBefore) {
      push({ kind: "tds_certificate", projectId: pay.projectId, title: "Ask the client for the TDS certificate (Form 16A)", detail: `${formatINR(pay.tdsDeducted)} deducted from the payment of ${pay.receivedDate} (ref ${pay.bankReference})`, href: `/projects/${pay.projectId}/finance`, at: pay.receivedDate });
    }
  }
  const st = db.select().from(studio).get();
  if (st) {
    const missing = [!st.legalName && "legal name", !st.address && "address", st.gstRegistered && !st.gstin && "GSTIN", st.msmeRegistered && !st.udyamNumber && "Udyam number"].filter(Boolean);
    if (missing.length) {
      push({ kind: "setup_studio", projectId: null, title: "Complete the studio details", detail: `Invoices and quotations print without your ${missing.join(", ")}`, href: "/settings#studio", at: st.createdAt });
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
