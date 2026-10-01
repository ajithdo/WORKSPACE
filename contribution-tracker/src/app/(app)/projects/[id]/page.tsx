import Link from "next/link";
import { eq } from "drizzle-orm";
import { formatDate, KeyValue, Money, Note, Points, Section } from "@/components/ui";
import { getDb } from "@/db";
import { taskInstances } from "@/db/schema";
import { stateName } from "@/lib/states";
import { requireMember } from "@/lib/session";
import { loadProject } from "@/server/common";
import { plannedTotal } from "@/server/contribution";
import { financeSummary } from "@/server/finance";
import { projectMilestones } from "@/server/milestones";
import { memberNames, projectHeader } from "@/server/queries";

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, client, members, config } = projectHeader(db, projectId);
  const tasks = db.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const live = tasks.filter((t) => t.status !== "cancelled" && t.status !== "proposed");
  const verifiedPts = live.filter((t) => t.status === "verified" || t.status === "locked").reduce((s, t) => s + t.defaultPoints * t.quantity * t.adjustmentFactor, 0);
  const milestones = p.kind === "client" ? projectMilestones(db, loadProject(db, projectId)) : [];
  const fin = financeSummary(db, projectId, new Date().toISOString().slice(0, 10));
  const names = memberNames(db);
  const nextGate = milestones.find((m) => m.state === "pending" && m.hardGate);
  const msConfig = new Map(config.milestones.map((m) => [m.code, m]));
  return (
    <>
      {nextGate ? (
        <Note tone="waiting">
          <strong>{nextGate.name}</strong> is not complete. Work behind this gate cannot start until {nextGate.missing.join(", ")} {nextGate.missing.length === 1 ? "is" : "are"} done.
        </Note>
      ) : null}
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div>
          {milestones.length ? (
            <Section title="Milestones" description="Hard gates protect the studio: no work before the contract and advance, no ownership transfer before final payment.">
              <ol className="relative space-y-0">
                {milestones.map((m) => {
                  const cfg = msConfig.get(m.code);
                  const done = m.state !== "pending";
                  return (
                    <li key={m.code} className="grid grid-cols-[1.75rem_1fr] gap-3 pb-3">
                      <span
                        aria-hidden
                        className={`mt-1 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
                          m.state === "complete" ? "border-verified bg-verified text-white" : m.state === "waived" ? "border-ink-faint text-ink-faint" : m.hardGate ? "border-ledger text-ledger" : "border-rule-strong text-ink-faint"
                        }`}
                      >
                        {m.state === "complete" ? "✓" : m.state === "waived" ? "–" : m.hardGate ? "!" : ""}
                      </span>
                      <div>
                        <p className={`font-semibold ${done ? "text-ink" : "text-ink"}`}>
                          {m.code} {m.name}
                          {m.hardGate ? <span className="ml-2 text-sm font-semibold text-ledger">hard gate</span> : null}
                        </p>
                        <p className="text-sm text-ink-soft">
                          {m.state === "complete"
                            ? `Done ${formatDate(m.achievedAt)}`
                            : m.state === "waived"
                              ? `Waived — ${m.waivedTasks.join(", ")} not in the plan`
                              : `Waiting on ${m.missing.join(", ")}`}
                          {cfg?.payment ? `. Payment: ${cfg.payment.replaceAll("_", " ")}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>
          ) : (
            <Section title="About this project">
              <p className="text-ink-soft">
                {p.kind === "studio"
                  ? "Studio work is not tied to a client. Its points share money released from the reserve, approved by both partners."
                  : "Maintenance work under an annual maintenance contract, invoiced separately from the build."}
              </p>
            </Section>
          )}
        </div>
        <aside className="space-y-6">
          <Section title="Points">
            <KeyValue
              items={[
                ["Planned", <Points key="p" value={plannedTotal(db, projectId)} />],
                ["Verified so far", <Points key="v" value={verifiedPts} />],
                ["Tasks", `${live.filter((t) => t.status === "verified" || t.status === "locked").length} of ${live.length} verified`],
              ]}
            />
            <Link href={`/projects/${projectId}/contribution`} className="mt-2 inline-block text-sm font-semibold text-royal hover:underline">
              See the live split
            </Link>
          </Section>
          <Section title="Money">
            <KeyValue
              items={[
                ["Quoted (before GST)", <Money key="q" paise={p.quotedAmountExGst} />],
                ["Invoiced (with GST)", <Money key="i" paise={fin.invoicedTotal} />],
                ["Revenue counted", <Money key="r" paise={fin.revenueExGstVerified} />],
                ["Outstanding", <Money key="o" paise={fin.outstanding} />],
              ]}
            />
            {fin.overdue.length ? <p className="mt-2 text-sm font-semibold text-ledger">{fin.overdue.length} invoice(s) overdue</p> : null}
          </Section>
          <Section title="Details">
            <KeyValue
              items={[
                ["Partners", members.map((m) => m.name).join(" and ")],
                ["Brought in by", p.originatedBy ? (names.get(p.originatedBy) ?? "") : "Nobody"],
                ["Client", client ? `${client.businessName}${client.contactName ? `, ${client.contactName}` : ""}` : "—"],
                ["Place of supply", stateName(p.placeOfSupplyState)],
                ["GST", p.gstRegistered ? `${p.gstRateBp / 100}% (SAC ${p.sacCode})` : "Not charged"],
                ["Start", formatDate(p.startDate)],
                ["Target launch", formatDate(p.targetLaunchDate)],
                ["Rules version", `v${p.configVersionId}`],
              ]}
            />
          </Section>
        </aside>
      </div>
    </>
  );
}
