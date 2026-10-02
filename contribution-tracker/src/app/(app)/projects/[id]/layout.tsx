import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Tabs } from "@/components/nav";
import { Pill } from "@/components/ui";
import { getDb } from "@/db";
import { disputes, taskInstances } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { DomainError } from "@/server/errors";
import { projectHeader } from "@/server/queries";

const TYPE_LABEL: Record<string, string> = {
  brochure: "Brochure site",
  cms: "CMS site",
  ecommerce: "E-commerce site",
  booking: "Booking site",
  custom: "Custom project",
  studio: "Studio work",
  maintenance: "Maintenance (AMC)",
};

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireMember();
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();
  const db = getDb();
  let header;
  try {
    header = projectHeader(db, projectId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { project: p, client } = header;
  const toVerify = db
    .select({ id: taskInstances.id })
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, p.id), eq(taskInstances.status, "submitted")))
    .all().length;
  const openDisputes = db
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(eq(disputes.projectId, p.id), inArray(disputes.status, ["open", "in_discussion", "escalated"])))
    .all().length;
  const base = `/projects/${p.id}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/plan`, label: "Plan" },
    { href: `${base}/board`, label: "Board", count: toVerify },
    { href: `${base}/communications`, label: "Communications" },
    ...(p.kind !== "studio" ? [{ href: `${base}/report`, label: "Client update" }] : []),
    ...(p.kind === "client" ? [{ href: `${base}/changes`, label: "Change requests" }] : []),
    { href: `${base}/finance`, label: "Finance" },
    ...(p.kind === "client" ? [{ href: `${base}/handover`, label: "Handover" }] : []),
    { href: `${base}/contribution`, label: "Contribution" },
    { href: `${base}/disputes`, label: "Disputes", count: openDisputes },
    { href: `${base}/files`, label: "Files" },
    ...(p.kind !== "studio" ? [{ href: `${base}/preview`, label: "Preview" }] : []),
    ...(p.kind !== "studio" ? [{ href: `${base}/assistant`, label: "AI assistant" }] : []),
    { href: `${base}/closure`, label: "Closure" },
  ];
  return (
    <>
      <div className="mb-4">
        <p className="text-sm text-ink-soft">
          {p.code}, {TYPE_LABEL[p.projectType] ?? p.projectType}
          {client ? ` for ${client.businessName}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight md:text-[1.75rem]">{p.name}</h1>
          {p.closeStatus === "closed_locked" ? <Pill tone="ledger">Closed and locked</Pill> : p.closeStatus !== "open" ? <Pill tone="waiting">Closing</Pill> : null}
          {p.planStatus === "locked" ? <Pill tone="verified">Plan locked</Pill> : p.planStatus === "awaiting_partner" ? <Pill tone="waiting">Plan awaiting approval</Pill> : <Pill>Plan in draft</Pill>}
        </div>
      </div>
      <Tabs items={tabs} />
      <div className="pt-6">{children}</div>
    </>
  );
}
