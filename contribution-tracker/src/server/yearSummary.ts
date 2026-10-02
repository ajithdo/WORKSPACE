import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { contributionSnapshots, distributions, expenses, invoices, members, payments, projects, reserveLedger } from "@/db/schema";
import { financialYearLabel } from "@/domain/money";
import { isoDate } from "./context";

export interface MemberYear {
  memberId: number;
  name: string;
  reimbursement: number;
  baseShare: number;
  poolShare: number;
  total: number;
  paid: number;
  due: number;
  projects: number;
}

/** One financial year across every project: what each partner earned and what the studio billed and received. */
export function yearSummary(db: AppDb, fy: string) {
  // Timestamps and plain dates alike are placed on the India calendar.
  const inFy = (d: string | null | undefined) => !!d && financialYearLabel(isoDate(new Date(d))) === fy;
  const snaps = new Map(db.select().from(contributionSnapshots).all().map((s) => [s.id, s]));
  const byMember = new Map<number, MemberYear & { projectIds: Set<number> }>();
  for (const m of db.select().from(members).all()) {
    byMember.set(m.id, { memberId: m.id, name: m.name, reimbursement: 0, baseShare: 0, poolShare: 0, total: 0, paid: 0, due: 0, projects: 0, projectIds: new Set() });
  }
  for (const d of db.select().from(distributions).all()) {
    const s = snaps.get(d.snapshotId);
    if (!s || s.status !== "locked" || !inFy(s.lockedAt)) continue;
    const row = byMember.get(d.memberId);
    if (!row) continue;
    row.reimbursement += d.reimbursement;
    row.baseShare += d.baseShare;
    row.poolShare += d.poolShare;
    row.total += d.total;
    if (d.paidOn) row.paid += d.total;
    else row.due += d.total;
    row.projectIds.add(d.projectId);
  }
  const partners = [...byMember.values()].map(({ projectIds, ...r }) => ({ ...r, projects: projectIds.size }));

  const issued = db.select().from(invoices).all().filter((i) => i.number && i.status !== "cancelled" && inFy(i.issueDate));
  const pays = db.select().from(payments).all().filter((p) => inFy(p.receivedDate));
  const exps = db.select().from(expenses).all().filter((e) => e.status === "approved" && inFy(e.expenseDate));
  const reserve = db.select().from(reserveLedger).all().filter((r) => r.status === "approved" && inFy(r.entryDate));
  const closed = db.select().from(projects).where(eq(projects.closeStatus, "closed_locked")).all().length;

  return {
    fy,
    partners,
    studio: {
      invoicedExGst: issued.reduce((s, i) => s + i.amountExGst, 0),
      gstInvoiced: issued.reduce((s, i) => s + i.cgst + i.sgst + i.igst, 0),
      cashReceived: pays.reduce((s, p) => s + p.amountReceived, 0),
      revenueExGst: pays.filter((p) => p.verifiedBy).reduce((s, p) => s + p.revenueExGst, 0),
      tdsDeducted: pays.reduce((s, p) => s + p.tdsDeducted, 0),
      tdsCertificatesPending: pays.filter((p) => p.tdsDeducted > 0 && p.tdsCertificateStatus === "pending").length,
      expenses: exps.reduce((s, e) => s + (e.acceptedAmount ?? e.amount), 0),
      reserveIn: reserve.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0),
      reserveOut: reserve.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0),
      projectsClosedAllTime: closed,
    },
  };
}

/** Financial years with any money movement, newest first; always includes the current year. */
export function summaryYears(db: AppDb, today: string): string[] {
  const years = new Set<string>([financialYearLabel(today)]);
  for (const p of db.select({ d: payments.receivedDate }).from(payments).all()) years.add(financialYearLabel(p.d));
  for (const i of db.select({ d: invoices.issueDate }).from(invoices).all()) years.add(financialYearLabel(i.d));
  for (const s of db.select({ d: contributionSnapshots.lockedAt }).from(contributionSnapshots).all()) if (s.d) years.add(financialYearLabel(isoDate(new Date(s.d))));
  return [...years].sort().reverse();
}
