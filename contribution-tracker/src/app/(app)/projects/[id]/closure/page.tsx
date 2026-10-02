import Link from "next/link";
import { isoDate } from "@/server/context";
import { desc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Field, formatDate, Money, Note, Pill, Points, ScrollTable, Section, Stamp } from "@/components/ui";
import type { CalcResult } from "@/domain/calc";
import { getDb } from "@/db";
import { contributionSnapshots, distributions, postLockAdjustments, retroItems } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { hasVoted } from "@/server/approvals";
import { closureChecklist } from "@/server/closure";
import { projectHeader } from "@/server/queries";
import {
  addressRetroAction,
  addRetroAction,
  approvePostLockAction,
  approveSnapshotAction,
  closureItemAction,
  computeSnapshotAction,
  distributionPaidAction,
  rejectPostLockAction,
  rejectSnapshotAction,
  requestPostLockAction,
  reverifyAction,
  startClosingAction,
} from "./actions";

export const metadata = { title: "Closure" };

export default async function ClosurePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, members } = projectHeader(db, projectId);
  const list = closureChecklist(db, projectId);
  const snaps = db.select().from(contributionSnapshots).where(eq(contributionSnapshots.projectId, projectId)).orderBy(desc(contributionSnapshots.seq)).all();
  const pending = snaps.find((s) => s.status === "awaiting_partner");
  const lockedSnaps = snaps.filter((s) => s.status === "locked");
  const dists = db.select().from(distributions).where(eq(distributions.projectId, projectId)).all();
  const retros = db.select().from(retroItems).where(eq(retroItems.projectId, projectId)).all();
  const adjustments = db.select().from(postLockAdjustments).where(eq(postLockAdjustments.projectId, projectId)).orderBy(desc(postLockAdjustments.id)).all();
  const name = (id: number | string) => members.find((m) => m.id === Number(id))?.name ?? String(id);
  const today = isoDate(new Date());
  const locked = p.closeStatus === "closed_locked";

  const SnapshotTable = ({ outputs }: { outputs: CalcResult }) => (
    <ScrollTable>
      <table className="ledger-table min-w-[36rem]">
        <thead>
          <tr>
            <th>Partner</th>
            <th className="num">Points</th>
            <th className="num">Share</th>
            <th className="num">Expenses back</th>
            <th className="num">Base</th>
            <th className="num">Pool</th>
            <th className="num">Payout</th>
          </tr>
        </thead>
        <tbody>
          {outputs.members.map((m) => (
            <tr key={m.memberId}>
              <td className="font-semibold">{name(m.memberId)}</td>
              <td className="num">
                <Points value={m.totalPoints} />
              </td>
              <td className="num">{(m.share * 100).toFixed(1)}%</td>
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
    </ScrollTable>
  );

  return (
    <>
      {p.closeStatus === "open" ? (
        <Note>
          Close the project when the work is done and paid. The checklist below checks itself where it can. When items 1–7 are done, compute the contribution snapshot: both partners approve it, then
          it is locked with a hash and nothing in the project can change again — corrections become separate adjustments.
        </Note>
      ) : locked ? (
        <Note tone="ledger">
          <strong>Closed and locked</strong> on {formatDate(p.closedAt)}. Record payouts as you make them; corrections go through a post-lock adjustment that every partner approves.
        </Note>
      ) : null}
      {p.closeStatus === "open" ? (
        <div className="mt-4">
          <ActionButton action={startClosingAction.bind(null, projectId)} label="Start closing" size="md" confirm="Start closing this project?" />
        </div>
      ) : null}

      <Section title="Closure checklist">
        <ol className="divide-y divide-rule">
          {list.map((i) => (
            <li key={i.index} className="grid grid-cols-[1.75rem_1fr] gap-3 py-2.5">
              <span aria-hidden className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${i.done ? "border-verified bg-verified text-white" : "border-rule-strong text-ink-faint"}`}>
                {i.done ? "✓" : i.index + 1}
              </span>
              <div>
                <p className="font-semibold">{i.label}</p>
                <p className="text-sm text-ink-soft">{i.detail}</p>
                {i.manual && p.closeStatus !== "open" && !(locked && i.index === 6) ? (
                  <ActionForm action={closureItemAction.bind(null, projectId, i.index)} className="mt-1 flex flex-wrap items-center gap-2" showSuccess={false}>
                    <label className="flex items-center gap-1 text-sm">
                      <input type="checkbox" name="done" defaultChecked={i.done} /> Done
                    </label>
                    <input className="field-input max-w-sm flex-1 py-0.5 text-sm" name="note" defaultValue={i.note} placeholder="Note" aria-label="Note" />
                    <SubmitButton variant="quiet" size="sm">
                      Save
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Retrospective" description="What went well, what to change, and calibration notes for the task library.">
        <ul className="mb-3 space-y-2">
          {retros.map((r) => (
            <li key={r.id} className="text-sm">
              {r.source === "dispute_threshold" ? <Pill tone="ledger">Required</Pill> : null} {r.text}
              {r.addressed ? <span className="text-verified"> — {r.addressedNote}</span> : null}
              {!r.addressed && !locked ? (
                <ActionForm action={addressRetroAction.bind(null, r.id)} className="mt-1 flex flex-wrap gap-2">
                  <input className="field-input max-w-md flex-1 py-0.5 text-sm" name="note" placeholder="What you agreed" required aria-label="What you agreed" />
                  <SubmitButton variant="quiet" size="sm">
                    Record
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
        <ActionForm action={addRetroAction.bind(null, projectId)} className="flex flex-wrap gap-2" resetOnSuccess>
          <input className="field-input max-w-lg flex-1" name="text" placeholder="Content arrived three weeks late; add a delay clause" required aria-label="Retrospective note" />
          <SubmitButton variant="secondary" size="sm">
            Add note
          </SubmitButton>
        </ActionForm>
      </Section>

      <Section title="Contribution snapshot">
        {p.closeStatus === "closing" ? <ActionButton action={computeSnapshotAction.bind(null, projectId)} label="Compute snapshot" size="md" /> : null}
        {pending ? (
          <div className="mt-3 space-y-3">
            <p>
              Snapshot {pending.seq}, computed {formatDate(pending.createdAt)} by {name(pending.createdBy ?? 0)}. Hash <span className="font-mono text-sm">{pending.hash.slice(0, 24)}…</span>
            </p>
            <SnapshotTable outputs={pending.outputs as CalcResult} />
            {!hasVoted(db, "snapshot", pending.id, pending.round, me.id) ? (
              <div className="flex flex-wrap items-start gap-2">
                <ActionButton action={approveSnapshotAction.bind(null, pending.id)} label="Approve and lock the project" size="md" confirm="Approve this split? When every partner approves, the project locks permanently." />
                <ActionForm action={rejectSnapshotAction.bind(null, pending.id)} className="flex flex-wrap gap-2">
                  <input className="field-input w-64" name="reason" placeholder="What is wrong" required aria-label="Reason" />
                  <SubmitButton variant="danger">Send back</SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">You approved. Waiting for your partner.</p>
            )}
          </div>
        ) : null}
        {lockedSnaps.map((s) => {
          const out = s.outputs as CalcResult;
          return (
            <div key={s.id} className="mt-4 space-y-2 border-t border-rule pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Stamp tone="ledger">Locked</Stamp>
                <span className="font-semibold">
                  {s.kind === "closure" ? "Closing snapshot" : `Adjustment snapshot (${s.period})`} #{s.seq}
                </span>
                <span className="font-mono text-xs text-ink-faint">sha256 {s.hash}</span>
              </div>
              <SnapshotTable outputs={out} />
              <div className="flex flex-wrap gap-3 text-sm">
                <Link className="font-semibold text-royal hover:underline" href={`/projects/${projectId}/statement/${s.id}`}>
                  Printable contribution statement
                </Link>
                <ActionButton action={reverifyAction.bind(null, s.id)} label="Re-verify hash" variant="quiet" showResult />
              </div>
            </div>
          );
        })}
      </Section>

      {dists.length ? (
        <Section title="Payouts" description="Record each transfer from the studio account. Negative amounts (from corrections) are paid back to the studio.">
          <table className="ledger-table text-sm">
            <thead>
              <tr>
                <th>Snapshot</th>
                <th>Partner</th>
                <th className="num">Amount</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {dists.map((d) => (
                <tr key={d.id}>
                  <td>#{snaps.find((s) => s.id === d.snapshotId)?.seq}</td>
                  <td>{name(d.memberId)}</td>
                  <td className="num">
                    <Money paise={d.total} />
                  </td>
                  <td>
                    {d.paidOn ? (
                      `${formatDate(d.paidOn)}, ref ${d.bankReference}`
                    ) : d.total === 0 ? (
                      "Nothing to pay"
                    ) : (
                      <ActionForm action={distributionPaidAction.bind(null, d.id)} className="flex flex-wrap gap-1">
                        <input className="field-input w-36 py-0.5" type="date" name="paid_on" defaultValue={today} aria-label="Paid on" />
                        <input className="field-input w-32 py-0.5" name="reference" placeholder="UTR" required aria-label="Bank reference" />
                        <SubmitButton variant="secondary" size="sm">
                          Mark paid
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {locked ? (
        <Section title="Corrections after lock" description="A late payment, a refund, a missed expense or a points correction. Recorded as a new snapshot in a later period; the locked one never changes.">
          <ul className="mb-4 space-y-2 text-sm">
            {adjustments.map((a) => (
              <li key={a.id}>
                <strong>{a.period}</strong> {a.reason} <Pill tone={a.status === "approved" ? "verified" : a.status === "requested" ? "waiting" : "ledger"}>{a.status}</Pill>
                {a.status === "requested" && !hasVoted(db, "post_lock_adjustment", a.id, a.round, me.id) ? (
                  <span className="ml-2 inline-flex gap-2">
                    <ActionButton action={approvePostLockAction.bind(null, a.id)} label="Approve" />
                    <ActionButton action={rejectPostLockAction.bind(null, a.id)} label="Reject" variant="danger" />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer font-semibold text-royal">Request a correction</summary>
            <ActionForm action={requestPostLockAction.bind(null, projectId)} className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Reason">
                  <input className="field-input" name="reason" required placeholder="Retention payment received after closing" />
                </Field>
              </div>
              <Field label="Revenue change (₹, ex GST)">
                <div className="flex gap-2">
                  <select className="field-input w-24" name="revenue_sign" aria-label="Increase or decrease">
                    <option value="plus">+</option>
                    <option value="minus">−</option>
                  </select>
                  <input className="field-input" name="revenue" inputMode="decimal" />
                </div>
              </Field>
              <Field label="Extra expense (₹)">
                <input className="field-input" name="expense_amount" inputMode="decimal" />
              </Field>
              <Field label="Expense paid by">
                <select className="field-input" name="expense_paid_by" defaultValue={me.id}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                  <option value="studio">Studio account</option>
                </select>
              </Field>
              <Field label="Expense description">
                <input className="field-input" name="expense_description" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Point corrections" hint={`One per line: member id, points (negative to reduce), note. Members: ${members.map((m) => `${m.id} = ${m.name}`).join(", ")}`}>
                  <textarea className="field-input" name="points" rows={2} placeholder={`${members[0]?.id ?? 1}, 2, V-11 was under-counted`} />
                </Field>
              </div>
              <div>
                <SubmitButton>Request correction</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Section>
      ) : null}
    </>
  );
}
