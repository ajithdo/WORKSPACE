const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN is a mod-36 check character over the first 14. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]!) * (i % 2 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36]!;
}

/**
 * Why a GSTIN is not acceptable, or null when it is. A typo on an invoice costs the client their
 * input tax credit, so the format, the check character and (when known) the state are verified.
 */
export function gstinProblem(raw: string, stateCode?: string): string | null {
  const g = raw.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return "A GSTIN has 15 characters: state code, PAN, entity number, Z and a check character";
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return "This GSTIN has a typo: its last (check) character does not match";
  if (stateCode && g.slice(0, 2) !== stateCode) return "The GSTIN's first two digits must match the state";
  return null;
}
