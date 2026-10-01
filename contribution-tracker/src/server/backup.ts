import fs from "node:fs";
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
