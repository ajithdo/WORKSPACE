import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { appendAudit } from "@/server/audit";
import { exportJson } from "@/server/backup";

export async function GET() {
  const member = await currentMember();
  if (!member) return new Response("Sign in first", { status: 401 });
  const db = getDb();
  const data = exportJson(db);
  appendAudit(db, { at: new Date().toISOString(), actorMemberId: member.id, action: "backup.export_json", entityType: "studio", entityId: 1 });
  return new Response(JSON.stringify(data, null, 1), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="contribution-tracker-${data.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
