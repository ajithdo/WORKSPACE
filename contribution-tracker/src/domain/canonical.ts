import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted at every level, no whitespace.
 * Used for audit-log and snapshot hashes, so the same data always hashes the same.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, "$");
}

function serialise(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: ${path} is not a finite number`);
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "bigint":
      return JSON.stringify(value.toString());
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => (v === undefined || typeof v === "function" ? "null" : serialise(v, `${path}[${i}]`))).join(",")}]`;
      }
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((k) => {
          const v = (value as Record<string, unknown>)[k];
          return v !== undefined && typeof v !== "function";
        })
        .map((k) => `${JSON.stringify(k)}:${serialise((value as Record<string, unknown>)[k], `${path}.${k}`)}`);
      return `{${entries.join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported value at ${path}`);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
