import { parseRupeesToPaise } from "@/domain/money";
import { DomainError } from "@/server/errors";

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const optStr = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : v;
};
export const bool = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
};

export function num(fd: FormData, k: string, label: string): number {
  const v = str(fd, k);
  const n = Number(v);
  if (v === "" || !Number.isFinite(n)) throw new DomainError("invalid", `${label} must be a number`);
  return n;
}

export function optNum(fd: FormData, k: string, label: string): number | null {
  return str(fd, k) === "" ? null : num(fd, k, label);
}

export function int(fd: FormData, k: string, label: string): number {
  const n = num(fd, k, label);
  if (!Number.isInteger(n)) throw new DomainError("invalid", `${label} must be a whole number`);
  return n;
}

export function optInt(fd: FormData, k: string, label: string): number | null {
  return str(fd, k) === "" ? null : int(fd, k, label);
}

/** Rupee input ("12,500" or "12500.50") → paise. */
export function money(fd: FormData, k: string, label: string): number {
  const p = parseRupeesToPaise(str(fd, k));
  if (p === null) throw new DomainError("invalid", `${label} must be an amount in rupees, like 12,500 or 12500.50`);
  return p;
}

export function optMoney(fd: FormData, k: string, label: string): number {
  return str(fd, k) === "" ? 0 : money(fd, k, label);
}

/** Percent inputs named share_<memberId> → basis points. */
export function sharesFrom(fd: FormData): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("share_")) continue;
    const pct = Number(String(v).trim() || "0");
    if (!Number.isFinite(pct) || pct < 0) throw new DomainError("invalid", "Shares must be percentages");
    const bp = Math.round(pct * 100);
    if (bp > 0) out[Number(k.slice(6))] = bp;
  }
  return out;
}

export function lines(fd: FormData, k: string): string[] {
  return str(fd, k)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The studio works in India: datetime-local inputs are IST (UTC+05:30, no daylight saving). */
export function istLocalToIso(local: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/.exec(local.trim());
  if (!m) throw new DomainError("invalid", "Enter a date and time");
  return new Date(`${m[1]}${m[2] ?? ":00"}+05:30`).toISOString();
}

/** Current time as a datetime-local value in IST, for form defaults. */
export function istNowLocal(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}
