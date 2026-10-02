import { asc } from "drizzle-orm";
import type { AppDb } from "@/db";
import { clients, invoices, payments, projects } from "@/db/schema";
import { financialYearLabel } from "@/domain/money";
import { stateName } from "@/lib/states";

/** Quotes a CSV cell and neutralises spreadsheet formulas (=, +, -, @) in text. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Financial years that have any issued invoice or payment, newest first. */
export function accountYears(db: AppDb): string[] {
  const years = new Set<string>();
  for (const i of db.select({ d: invoices.issueDate, n: invoices.number }).from(invoices).all()) if (i.n) years.add(financialYearLabel(i.d));
  for (const p of db.select({ d: payments.receivedDate }).from(payments).all()) years.add(financialYearLabel(p.d));
  return [...years].sort().reverse();
}

/** Issued invoices of one financial year, in number order, with the columns GST returns need. */
export function invoicesCsv(db: AppDb, fy: string): string {
  const cl = new Map(db.select().from(clients).all().map((c) => [c.id, c]));
  const pr = new Map(db.select().from(projects).all().map((p) => [p.id, p]));
  const rows = db
    .select()
    .from(invoices)
    .orderBy(asc(invoices.seq))
    .all()
    .filter((i) => i.number && financialYearLabel(i.issueDate) === fy)
    .map((i) => {
      const p = pr.get(i.projectId);
      const c = p?.clientId ? cl.get(p.clientId) : undefined;
      return [
        i.number,
        i.issueDate,
        c?.businessName ?? "",
        c?.gstin ?? "",
        c?.stateCode ? `${c.stateCode}-${stateName(c.stateCode)}` : "",
        p?.code ?? "",
        i.type,
        "998314",
        rupees(i.amountExGst),
        i.gstRateBp / 100,
        rupees(i.cgst),
        rupees(i.sgst),
        rupees(i.igst),
        rupees(i.total),
        i.status,
        i.cancelledReason ?? "",
      ];
    });
  return toCsv(
    ["Invoice no", "Invoice date", "Client", "Client GSTIN", "Place of supply", "Project", "Type", "SAC", "Taxable value", "GST rate %", "CGST", "SGST", "IGST", "Invoice total", "Status", "Cancelled reason"],
    rows,
  );
}

/** Payments received in one financial year, with TDS for reconciling against Form 26AS. */
export function paymentsCsv(db: AppDb, fy: string): string {
  const inv = new Map(db.select().from(invoices).all().map((i) => [i.id, i]));
  const cl = new Map(db.select().from(clients).all().map((c) => [c.id, c]));
  const pr = new Map(db.select().from(projects).all().map((p) => [p.id, p]));
  const rows = db
    .select()
    .from(payments)
    .orderBy(asc(payments.receivedDate), asc(payments.id))
    .all()
    .filter((p) => financialYearLabel(p.receivedDate) === fy)
    .map((p) => {
      const i = inv.get(p.invoiceId);
      const proj = pr.get(p.projectId);
      const c = proj?.clientId ? cl.get(proj.clientId) : undefined;
      return [
        p.receivedDate,
        i?.number ?? "",
        c?.businessName ?? "",
        c?.gstin ?? "",
        p.mode.toUpperCase(),
        p.bankReference,
        rupees(p.amountReceived),
        rupees(p.tdsDeducted),
        rupees(p.gstComponent),
        rupees(p.revenueExGst),
        p.tdsDeducted > 0 ? p.tdsCertificateStatus : "",
        p.verifiedBy ? "yes" : "no",
      ];
    });
  return toCsv(["Received on", "Invoice no", "Client", "Client GSTIN", "Mode", "Bank reference", "Cash received", "TDS deducted", "GST in payment", "Revenue ex GST", "TDS certificate", "Checked by partner"], rows);
}
