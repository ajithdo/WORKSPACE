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

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ""}`;
  return [h ? `${ONES[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}

/** Whole numbers in the Indian system (thousand, lakh, crore), as printed on invoices. */
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [crore ? `${indianWords(crore)} Crore` : "", lakh ? `${below1000(lakh)} Lakh` : "", thousand ? `${below1000(thousand)} Thousand` : "", rest ? below1000(rest) : ""].filter(Boolean).join(" ");
}

/** "Rupees Seventy Thousand Eight Hundred Only", with paise when present. */
export function amountInWordsINR(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  return `${paise < 0 ? "Minus " : ""}Rupees ${indianWords(rupees)}${p ? ` and ${below1000(p)} Paise` : ""} Only`;
}

/**
 * Splits a total across weighted lines in whole rupees (largest remainder, ties to the earlier line),
 * so the lines always add up exactly to the total.
 */
export function allocateByWeight(totalPaise: number, weights: number[]): number[] {
  const rupees = Math.round(totalPaise / 100);
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? rupees * 100 : 0));
  const exact = weights.map((w) => (rupees * Math.max(0, w)) / sum);
  const floor = exact.map(Math.floor);
  let left = rupees - floor.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i]! += 1;
    left -= 1;
  }
  return floor.map((r) => r * 100);
}
