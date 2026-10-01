import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Money, Points } from "@/components/ui";
import type { CalcResult } from "@/domain/calc";
import type { CalcParams } from "@/domain/config";
import { getDb } from "@/db";
import { contributionSnapshots } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { projectHeader } from "@/server/queries";
import { getStudio } from "@/server/settings";
import { PrintButton } from "./print-button";

export const metadata = { title: "Contribution statement" };

export default async function StatementPage({ params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  await requireMember();
  const { id, snapshotId } = await params;
  const db = getDb();
  const s = db.select().from(contributionSnapshots).where(eq(contributionSnapshots.id, Number(snapshotId))).get();
  if (!s || s.projectId !== Number(id)) notFound();
  const { project: p, client, members } = projectHeader(db, s.projectId);
  const studio = getStudio(db);
  const out = s.outputs as CalcResult;
  const params_ = s.params as CalcParams;
  const name = (mid: string) => members.find((m) => String(m.id) === mid)?.name ?? mid;
  return (
    <article className="mx-auto max-w-3xl text-[15px]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-soft">{studio?.legalName || studio?.name}</p>
          <h2 className="text-2xl font-bold">Internal contribution statement</h2>
          <p className="text-ink-soft">
            {p.code} {p.name}
            {client ? `, ${client.businessName}` : ""}. {s.kind === "closure" ? "Closing snapshot" : `Adjustment for ${s.period}`} #{s.seq}, {s.status === "locked" ? `locked ${s.lockedAt?.slice(0, 10)}` : s.status}.
          </p>
        </div>
        <PrintButton />
      </div>
      <h3 className="mb-1 font-bold">Money waterfall (cash received)</h3>
      <table className="ledger-table mb-6">
        <tbody>
          <tr>
            <td>Revenue received, excluding GST{params_.distribute_tds_credit ? ", including TDS credit" : " (TDS credit not distributed)"}</td>
            <td className="num">
              <Money paise={out.revenuePaise} />
            </td>
          </tr>
          <tr>
            <td>Less approved project expenses</td>
            <td className="num">
              <Money paise={-out.expensesPaise} />
            </td>
          </tr>
          <tr>
            <td>Less business reserve ({Math.round(params_.reserve_pct * 100)}%, absorbs rounding)</td>
            <td className="num">
              <Money paise={-out.reservePaise} />
            </td>
          </tr>
          <tr>
            <td className="font-semibold">Distributable profit</td>
            <td className="num font-semibold">
              <Money paise={out.distributablePaise} />
            </td>
          </tr>
        </tbody>
      </table>
      <h3 className="mb-1 font-bold">Distribution</h3>
      <table className="ledger-table mb-6">
        <thead>
          <tr>
            <th>Partner</th>
            <th className="num">Verified points</th>
            <th className="num">Expenses back</th>
            <th className="num">Base {Math.round(params_.base_share_pct * 100)}%</th>
            <th className="num">Pool {Math.round(params_.pool_pct * 100)}%</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {out.members.map((m) => (
            <tr key={m.memberId}>
              <td className="font-semibold">{name(m.memberId)}</td>
              <td className="num">
                <Points value={m.totalPoints} /> ({(m.share * 100).toFixed(1)}%)
              </td>
              <td className="num">
                <Money paise={m.reimbursementPaidPaise} />
              </td>
              <td className="num">
                <Money paise={m.basePaise} />
              </td>
              <td className="num">
                <Money paise={m.poolPaise} />
              </td>
              <td className="num font-bold">
                <Money paise={m.payoutPaise} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-ink-soft">
        Caps applied: communication {Math.round(params_.communication_cap_pct * 100)}%, sales {Math.round(params_.sales_cap_pct * 100)}%, 1-point tasks {Math.round(params_.micro_task_cap_pct * 100)}% per
        partner. Payouts are rounded to the rupee; the reserve absorbs the remainder so totals reconcile. Calculation version {s.calcVersion}, rules version {s.configVersionId}.
      </p>
      <p className="mt-2 break-all font-mono text-xs text-ink-faint">SHA-256 of inputs, parameters and outputs: {s.hash}</p>
      <div className="mt-10 grid grid-cols-2 gap-10">
        {members.map((m) => (
          <div key={m.id}>
            <div className="h-12 border-b border-ink" />
            <p className="mt-1 text-sm">{m.name}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
