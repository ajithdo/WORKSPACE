import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { ensureTriggers } from "./triggers";

export type AppDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
/** A transaction handle; services accept either the db or a transaction. */
export type DbOrTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0] | AppDb;

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export function openDb(file: string): AppDb {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  if (file !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema }) as AppDb;
  if (file !== ":memory:") snapshotBeforeUpgrade(sqlite, file);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  ensureTriggers(sqlite);
  return db;
}

/**
 * Before an app update applies new migrations to an existing database, keep a consistent copy
 * (VACUUM INTO) next to it in backups/, so a bad upgrade can always be rolled back.
 */
export function snapshotBeforeUpgrade(sqlite: Database.Database, file: string): string | null {
  const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!hasTable) return null; // a brand-new database: nothing to protect
  // Same rule as drizzle's migrator: a migration is pending when it is newer than the last one applied.
  const last = Number((sqlite.prepare("SELECT max(created_at) AS t FROM __drizzle_migrations").get() as { t: number | null }).t ?? 0);
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf-8")) as { entries: { when: number }[] };
  const pending = journal.entries.filter((e) => e.when > last).length;
  if (!pending) return null;
  const dir = path.join(path.dirname(file), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `pre-upgrade-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  sqlite.prepare("VACUUM INTO ?").run(dest);
  console.log(`Database copied to ${dest} before applying ${pending} update(s).`);
  return dest;
}

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
}

const globalForDb = globalThis as unknown as { __contributionDb?: AppDb };

/** Process-wide database handle (survives Next.js dev hot reloads). */
export function getDb(): AppDb {
  if (!globalForDb.__contributionDb) globalForDb.__contributionDb = openDb(path.join(dataDir(), "app.db"));
  return globalForDb.__contributionDb;
}

export { schema };
