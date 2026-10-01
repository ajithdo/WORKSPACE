import Link from "next/link";
import { Empty, PageHeader, Pill } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { projectList } from "@/server/queries";

export const metadata = { title: "Projects" };

const TYPE_LABEL: Record<string, string> = {
  brochure: "Brochure site",
  cms: "CMS site",
  ecommerce: "E-commerce",
  booking: "Booking site",
  custom: "Custom",
  studio: "Studio work",
  maintenance: "Maintenance (AMC)",
};

export default async function ProjectsPage() {
  await requireMember();
  const rows = projectList(getDb());
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Each project carries its own plan, evidence, money and closing split."
        actions={
          <Link href="/projects/new" className="rounded-md border border-royal bg-royal px-4 py-2 font-semibold text-white hover:bg-royal-dark">
            New project
          </Link>
        }
      />
      {rows.length === 0 ? (
        <Empty title="No projects yet">Create the first one: the plan is pre-filled from the 343-task library for the kind of site you are building.</Empty>
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((p) => (
            <li key={p.id} className="grid gap-2 py-4 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <Link href={`/projects/${p.id}`} className="text-lg font-bold text-ink hover:text-royal hover:underline">
                  {p.name}
                </Link>
                <p className="text-sm text-ink-soft">
                  {p.code}, {TYPE_LABEL[p.projectType] ?? p.projectType}
                  {p.clientName ? ` for ${p.clientName}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  {p.closeStatus === "closed_locked" ? <Pill tone="ledger">Closed and locked</Pill> : p.closeStatus !== "open" ? <Pill tone="waiting">Closing</Pill> : null}
                  {p.planStatus === "draft" ? <Pill>Plan in draft</Pill> : p.planStatus === "awaiting_partner" ? <Pill tone="waiting">Plan awaiting approval</Pill> : <Pill tone="verified">Plan locked</Pill>}
                  {p.waitingCheck ? <Pill tone="waiting">{p.waitingCheck} to verify</Pill> : null}
                  {p.nextMilestone ? (
                    <span className="text-ink-soft">
                      Next: {p.nextMilestone.name}
                      {p.nextMilestone.hardGate ? " (hard gate)" : ""}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="w-full md:w-56">
                <div className="flex justify-between text-sm text-ink-soft">
                  <span>Tasks verified</span>
                  <span className="tabular-nums">
                    {p.taskDone}/{p.taskTotal}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-page" role="progressbar" aria-valuemin={0} aria-valuemax={p.taskTotal} aria-valuenow={p.taskDone} aria-label="Tasks verified">
                  <div className="h-full bg-verified" style={{ width: `${p.taskTotal ? (100 * p.taskDone) / p.taskTotal : 0}%` }} />
                </div>
                {p.milestonesTotal ? (
                  <p className="mt-1 text-right text-xs text-ink-faint">
                    {p.milestonesDone} of {p.milestonesTotal} milestones
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
