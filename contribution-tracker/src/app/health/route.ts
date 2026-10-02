import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/** Liveness check for Docker and uptime monitors: the database opens and answers. No data is returned. */
export function GET() {
  try {
    getDb().$client.prepare("select 1").get();
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
