import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import type { AppDb } from "@/db";
import { clients, invoices, payments, projectMembers, projects, taskInstances } from "@/db/schema";

export interface SearchHit {
  kind: "project" | "client" | "invoice" | "payment" | "task";
  title: string;
  detail: string;
  href: string;
}

/** Escapes LIKE wildcards so a search for "50%" or "INV_1" matches literally. */
function pattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Finds projects, clients, invoices, payments (bank references) and tasks the member can see. */
export function search(db: AppDb, memberId: number, raw: string, limit = 20): SearchHit[] {
  const q = raw.trim();
  if (q.length < 2) return [];
  const p = pattern(q);
  const esc = sql`'\\'`;
  const likeE = (col: Parameters<typeof like>[0]) => sql`${col} LIKE ${p} ESCAPE ${esc}`;
  const mine = db.select({ id: projectMembers.projectId }).from(projectMembers).where(and(eq(projectMembers.memberId, memberId), eq(projectMembers.active, true))).all().map((r) => r.id);
  if (!mine.length) return [];
  const projectRows = db.select().from(projects).where(inArray(projects.id, mine)).all();
  const projectName = new Map(projectRows.map((r) => [r.id, `${r.code} · ${r.name}`]));
  const hits: SearchHit[] = [];

  for (const r of db.select().from(projects).where(and(inArray(projects.id, mine), or(likeE(projects.name), likeE(projects.code)))).limit(limit).all()) {
    hits.push({ kind: "project", title: `${r.code} · ${r.name}`, detail: r.closeStatus === "closed_locked" ? "Closed" : "Open", href: `/projects/${r.id}` });
  }
  const clientProjects = new Map<number, number>();
  for (const r of projectRows) if (r.clientId && !clientProjects.has(r.clientId)) clientProjects.set(r.clientId, r.id);
  const clientIds = [...clientProjects.keys()];
  if (clientIds.length) {
    for (const c of db
      .select()
      .from(clients)
      .where(and(inArray(clients.id, clientIds), or(likeE(clients.businessName), likeE(clients.gstin), likeE(clients.contactName), likeE(clients.contactEmail), likeE(clients.contactPhone))))
      .limit(limit)
      .all()) {
      hits.push({ kind: "client", title: c.businessName, detail: [c.contactName, c.gstin].filter(Boolean).join(" · ") || "Client", href: `/projects/${clientProjects.get(c.id)}` });
    }
  }
  for (const i of db.select().from(invoices).where(and(inArray(invoices.projectId, mine), likeE(invoices.number))).limit(limit).all()) {
    hits.push({ kind: "invoice", title: i.number ?? "Draft", detail: projectName.get(i.projectId) ?? "", href: `/projects/${i.projectId}/invoice/${i.id}` });
  }
  for (const pay of db.select().from(payments).where(and(inArray(payments.projectId, mine), likeE(payments.bankReference))).limit(limit).all()) {
    hits.push({ kind: "payment", title: `Payment ${pay.bankReference}`, detail: `${pay.receivedDate} · ${projectName.get(pay.projectId) ?? ""}`, href: `/projects/${pay.projectId}/finance` });
  }
  for (const t of db.select().from(taskInstances).where(and(inArray(taskInstances.projectId, mine), or(likeE(taskInstances.code), likeE(taskInstances.name)))).limit(limit).all()) {
    hits.push({ kind: "task", title: `${t.code} ${t.name}`, detail: `${t.status.replaceAll("_", " ")} · ${projectName.get(t.projectId) ?? ""}`, href: `/projects/${t.projectId}/tasks/${t.id}` });
  }
  return hits.slice(0, limit * 3);
}
