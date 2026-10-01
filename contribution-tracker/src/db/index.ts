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
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  ensureTriggers(sqlite);
  return db;
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
