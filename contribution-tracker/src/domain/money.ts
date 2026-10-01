/** All money is integer paise. These helpers keep rupee/paise conversions and Indian tax rules in one place. */

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Parses "1,18,000.50" or "250" into paise. Returns null for anything that is not a non-negative amount with ≤2 decimals. */
export function parseRupeesToPaise(input: string): number | null {
  const s = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

const inrFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const inrWholeFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function formatINR(paise: number): string {
  return inrFormatter.format(paise / 100);
}

export function formatINRWhole(paise: number): string {
  return inrWholeFormatter.format(Math.round(paise / 100));
}

/** Rounds half away from zero to a whole paisa. */
export function roundPaise(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

export interface GstSplit {
  cgst: number;
  sgst: number;
  igst: number;
  gstTotal: number;
  total: number;
}

/** Intra-state supplies carry CGST + SGST (half the rate each); inter-state carry IGST. rateBp: 1800 = 18%. */
export function splitGst(amountExGst: number, rateBp: number, intraState: boolean): GstSplit {
  if (rateBp <= 0) return { cgst: 0, sgst: 0, igst: 0, gstTotal: 0, total: amountExGst };
  if (intraState) {
    const half = roundPaise((amountExGst * rateBp) / 20000);
    return { cgst: half, sgst: half, igst: 0, gstTotal: half * 2, total: amountExGst + half * 2 };
  }
  const igst = roundPaise((amountExGst * rateBp) / 10000);
  return { cgst: 0, sgst: 0, igst, gstTotal: igst, total: amountExGst + igst };
}

/** TDS is deducted on the value before GST. rateBp: 1000 = 10%. */
export function tdsAmount(amountExGst: number, rateBp: number): number {
  return roundPaise((amountExGst * rateBp) / 10000);
}

/**
 * Splits one payment into its GST share and revenue ex-GST (decision D5).
 * gross settled = cash received + TDS deducted; GST share is removed pro rata to the invoice.
 */
export function paymentRevenue(
  payment: { amountReceived: number; tdsDeducted: number },
  invoice: { total: number; gstTotal: number },
): { grossSettled: number; gstComponent: number; revenueExGst: number } {
  const grossSettled = payment.amountReceived + payment.tdsDeducted;
  const gstComponent = invoice.total > 0 ? roundPaise((grossSettled * invoice.gstTotal) / invoice.total) : 0;
  return { grossSettled, gstComponent, revenueExGst: payment.amountReceived - gstComponent };
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** MSMED Act: payment due by the earlier of the agreed date and acceptance + 45 days. */
export function msmeDueDate(agreedDue: string, acceptanceDate: string, days: number): string {
  const statutory = addDaysIso(acceptanceDate, days);
  return statutory < agreedDue ? statutory : agreedDue;
}

/** Indian financial year label: 1 Apr 2026 – 31 Mar 2027 → "26-27". */
export function financialYearLabel(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** GST invoices: unique per financial year, at most 16 characters. */
export function formatInvoiceNumber(prefix: string, fyLabel: string, seq: number): string {
  const n = `${prefix}/${fyLabel}/${String(seq).padStart(3, "0")}`;
  if (n.length > 16) throw new Error(`Invoice number "${n}" is longer than the 16 characters GST allows; use a shorter prefix`);
  return n;
}
