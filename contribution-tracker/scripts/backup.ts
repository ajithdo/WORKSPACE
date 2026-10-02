/**
 * Writes a consistent copy of the database (safe while the app runs) and a JSON export.
 * Usage: npm run backup [-- <destination folder>]   (default: $DATA_DIR/backups)
 * Uploaded files live in $DATA_DIR/files; copy that folder too (it only ever grows).
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, getDb } from "@/db";
import { backupDatabase, exportJson } from "@/server/backup";

const dest = process.argv[2] ?? path.join(dataDir(), "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const db = getDb();
const dbFile = await backupDatabase(db, path.join(dest, `app-${stamp}.db`));
const jsonFile = path.join(dest, `export-${stamp}.json`);
fs.writeFileSync(jsonFile, JSON.stringify(exportJson(db), null, 2));
console.log(`Database: ${dbFile}\nJSON export: ${jsonFile}\nAlso copy: ${path.join(dataDir(), "files")}`);
