import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { invoicesCsv, paymentsCsv } from "@/server/accounts";
import { appendAudit } from "@/server/audit";

export async function GET(req: Request) {
  const member = await currentMember();
  if (!member) return new Response("Sign in first", { status: 401 });
  const url = new URL(req.url);
  const fy = url.searchParams.get("fy") ?? "";
  const kind = url.searchParams.get("kind");
  if (!/^\d{2}-\d{2}$/.test(fy) || (kind !== "invoices" && kind !== "payments")) return new Response("Choose a financial year and a report", { status: 400 });
  const db = getDb();
  const csv = kind === "invoices" ? invoicesCsv(db, fy) : paymentsCsv(db, fy);
  appendAudit(db, { at: new Date().toISOString(), actorMemberId: member.id, action: "accounts.export_csv", entityType: "studio", entityId: 1, after: { fy, kind } });
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-FY${fy}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
