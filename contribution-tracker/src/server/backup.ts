import fs from "node:fs";
import { isoDate } from "./context";
import path from "node:path";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import type { AppDb } from "@/db";
import * as schema from "@/db/schema";

const EXCLUDE = new Set(["sessions"]);

/** Full JSON export of every table (sessions and password hashes left out). */
export function exportJson(db: AppDb) {
  const tables: Record<string, unknown[]> = {};
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== "object" || !("getSQL" in (value as object))) continue;
    let name: string;
    try {
      name = getTableConfig(value as SQLiteTable).name;
    } catch {
      continue;
    }
    if (EXCLUDE.has(name)) continue;
    const rows = db.$client.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
    tables[name] = name === "members" ? rows.map(({ password_hash: _omit, ...r }) => r) : rows;
  }
  return { app: "contribution-tracker", exportedAt: new Date().toISOString(), tables };
}

/** Consistent online copy of the SQLite database (safe while the app is running). */
export async function backupDatabase(db: AppDb, destFile: string): Promise<string> {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  await db.$client.backup(destFile);
  return destFile;
}

/**
 * Daily safety copy into DATA_DIR/backups, keeping the newest `keep` files. Protects against
 * mistakes and corruption; it is not an off-site backup, so still copy the data folder elsewhere.
 * Returns the file written, or null when today's copy already exists.
 */
export async function autoBackup(db: AppDb, dir: string, now: Date, keep: number): Promise<string | null> {
  const name = `auto-${isoDate(now)}.db`;
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) return null;
  await backupDatabase(db, dest);
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) fs.rmSync(path.join(dir, f));
  return dest;
}

let backupRunning = false;
let backedUpDay = "";

/** Fire-and-forget daily backup; AUTO_BACKUP_DAYS (default 14) copies are kept, 0 turns it off. */
export function maybeAutoBackup(db: AppDb, dataDirectory: string, now = new Date()) {
  const keep = Number(process.env.AUTO_BACKUP_DAYS ?? 14);
  const day = isoDate(now);
  if (!Number.isFinite(keep) || keep <= 0 || backupRunning || backedUpDay === day) return;
  backupRunning = true;
  autoBackup(db, path.join(dataDirectory, "backups"), now, Math.floor(keep))
    .then(() => {
      backedUpDay = day;
    })
    .catch((e) => console.error("automatic backup failed", e))
    .finally(() => {
      backupRunning = false;
    });
}

/** Newest automatic copy, for the Settings page. */
export function latestAutoBackup(dataDirectory: string): { name: string; at: string; count: number } | null {
  const dir = path.join(dataDirectory, "backups");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  const last = files.at(-1);
  return last ? { name: last, at: fs.statSync(path.join(dir, last)).mtime.toISOString(), count: files.length } : null;
}
