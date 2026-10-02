import fs from "node:fs";
import { isoDate } from "@/server/context";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { appendAudit } from "@/server/audit";
import { backupDatabase } from "@/server/backup";

export async function GET() {
  const member = await currentMember();
  if (!member) return new Response("Sign in first", { status: 401 });
  const db = getDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-backup-"));
  const file = path.join(dir, "app.db");
  await backupDatabase(db, file);
  const body = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true });
  appendAudit(db, { at: new Date().toISOString(), actorMemberId: member.id, action: "backup.download_db", entityType: "studio", entityId: 1 });
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="contribution-tracker-${isoDate(new Date())}.db"`,
      "Cache-Control": "no-store",
    },
  });
}
