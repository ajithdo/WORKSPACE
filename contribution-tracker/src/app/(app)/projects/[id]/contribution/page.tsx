import Link from "next/link";
import { KeyValue, Money, Note, Points, ScrollTable, Section } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { liveContribution } from "@/server/contribution";
import { projectHeader } from "@/server/queries";

export const metadata = { title: "Contribution" };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default async function ContributionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, config } = projectHeader(db, projectId);
  const live = liveContribution(db, projectId);
  const r = live.result;
  const cat = new Map(config.categories.map((c) => [c.code, c.name]));
  const n = (id: string) => live.names.get(id) ?? id;
  return (
    <>
      <Note>
        A live preview from verified work and checked payments only. It becomes final when both partners approve the closing snapshot. {p.kind === "studio" ? "Studio projects take no reserve: they are already paid from it." : ""}
      </Note>
      {live.warnings.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-waiting">
          {live.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <Section title="Who gets what, if the project closed today">
        <ScrollTable>
          <table className="ledger-table min-w-[44rem]">
            <thead>
              <tr>
                <th>Partner</th>
                <th className="num">Points</th>
                <th className="num">Share</th>
                <th className="num">Expenses back</th>
                <th className="num">Base (equal)</th>
                <th className="num">Pool (by points)</th>
                <th className="num">Payout</th>
                <th className="num">Equal split would be</th>
              </tr>
            </thead>
            <tbody>
              {r.members.map((m) => (
                <tr key={m.memberId}>
                  <td className="font-semibold">{n(m.memberId)}</td>
                  <td className="num">
                    <Points value={m.totalPoints} />
                  </td>
                  <td className="num">{pct(m.share)}</td>
                  <td className="num">
                    <Money paise={m.reimbursementPaidPaise} />
                    {m.shortfallPaise ? <span className="block text-xs text-ledger">short by {(m.shortfallPaise / 100).toFixed(2)}</span> : null}
                  </td>
                  <td className="num">
                    <Money paise={m.basePaise} />
                  </td>
                  <td className="num">
                    <Money paise={m.poolPaise} />
                  </td>
                  <td className="num text-lg font-bold">
                    <Money paise={m.payoutPaise} />
                  </td>
                  <td className="num text-ink-soft">
                    <Money paise={m.equalSplitPaise} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
        <div className="mt-4 max-w-xl">
          <KeyValue
            items={[
              ["Revenue counted (ex GST)", <Money key="r" paise={r.revenuePaise} />],
              ["Approved expenses", <Money key="e" paise={r.expensesPaise} />],
              [`Reserve (${Math.round(live.params.reserve_pct * 100)}%)`, <Money key="res" paise={r.reservePaise} />],
              ["Distributable", <Money key="d" paise={r.distributablePaise} />],
              ["Split", `${Math.round(live.params.base_share_pct * 100)}% equally, ${Math.round(live.params.pool_pct * 100)}% by points`],
            ]}
          />
        </div>
      </Section>

      <Section title="Where the points come from" description="Communication, sales and 1-point tasks are capped so they cannot crowd out delivery work.">
        <ScrollTable>
          <table className="ledger-table min-w-[40rem]">
            <thead>
              <tr>
                <th>Partner</th>
                <th className="num">Delivery</th>
                <th className="num">1-point tasks</th>
                <th className="num">Communication</th>
                <th className="num">Sales and origination</th>
                <th className="num">From adjustments</th>
              </tr>
            </thead>
            <tbody>
              {r.members.map((m) => (
                <tr key={m.memberId}>
                  <td className="font-semibold">{n(m.memberId)}</td>
                  <td className="num">
                    <Points value={m.points.other} />
                  </td>
                  <td className="num">
                    <Points value={m.points.micro} />
                    {m.rawPoints.micro !== m.points.micro ? <span className="block text-xs text-waiting">capped from {m.rawPoints.micro.toFixed(1)}</span> : null}
                  </td>
                  <td className="num">
                    <Points value={m.points.comm} />
                    {m.rawPoints.comm !== m.points.comm ? <span className="block text-xs text-waiting">capped from {m.rawPoints.comm.toFixed(1)}</span> : null}
                  </td>
                  <td className="num">
                    <Points value={m.points.sales} />
                    {m.rawPoints.sales !== m.points.sales ? <span className="block text-xs text-waiting">capped from {m.rawPoints.sales.toFixed(1)}</span> : null}
                  </td>
                  <td className="num">
                    <Points value={m.adjustmentPoints} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
        <p className="mt-2 text-sm text-ink-soft">
          Caps: communication {pct(live.params.communication_cap_pct)} of the project, sales {pct(live.params.sales_cap_pct)}, 1-point tasks {pct(live.params.micro_task_cap_pct)} of each partner&apos;s
          points. {live.held.tasks.size + live.held.communications.size ? `Held by open disputes: ${live.held.tasks.size} task(s), ${live.held.communications.size} communication(s).` : ""}
        </p>
      </Section>

      <Section title="Calibration" description="Hours logged per verified point, by category. Feeds the quarterly review of default points.">
        {live.calibration.length ? (
          <ScrollTable>
            <table className="ledger-table min-w-[36rem]">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Planned</th>
                  <th className="num">Verified</th>
                  <th className="num">Hours logged</th>
                  <th className="num">Hours per point</th>
                </tr>
              </thead>
              <tbody>
                {live.calibration.map((c) => (
                  <tr key={c.categoryCode}>
                    <td>
                      {c.categoryCode} {cat.get(c.categoryCode)}
                    </td>
                    <td className="num">
                      <Points value={c.plannedPoints} />
                    </td>
                    <td className="num">
                      <Points value={c.verifiedPoints} />
                    </td>
                    <td className="num">{c.hours.toFixed(1)}</td>
                    <td className="num">{c.hoursPerPoint === null ? "—" : c.hoursPerPoint.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        ) : null}
        <p className="mt-2 text-sm">
          <Link className="font-semibold text-royal hover:underline" href="/library#calibration">
            Studio-wide calibration report
          </Link>
        </p>
      </Section>
    </>
  );
}
