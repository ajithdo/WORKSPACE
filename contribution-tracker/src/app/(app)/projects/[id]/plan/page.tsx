import Link from "next/link";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { OwnerSelect } from "@/components/owner-select";
import { Field, Note, Pill, Points, Section, TaskStatus } from "@/components/ui";
import { PHASE_LABELS, type Phase } from "@/domain/types";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { memberNames, planView } from "@/server/queries";
import {
  addCustomTaskAction,
  addLibraryTasksAction,
  approvePlanAction,
  approveProposalAction,
  rejectPlanAction,
  rejectProposalAction,
  removeTaskAction,
  repinRulesAction,
  setOwnerAction,
  submitPlanAction,
  withdrawPlanAction,
} from "./actions";

export const metadata = { title: "Plan" };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const v = planView(db, projectId);
  const p = v.project;
  const names = memberNames(db);
  const members = [...v.perMember.keys()].map((id) => ({ id, name: names.get(id) ?? `#${id}` }));
  const draft = p.planStatus === "draft" && p.closeStatus !== "closed_locked";
  const iApproved = v.votes.some((x) => x.memberId === me.id && x.decision === "approve");
  const total = [...v.perMember.values()].reduce((s, x) => s + x, 0);
  const phases = [...new Set(v.rows.map((r) => r.phase))];
  const proposals = v.rows.filter((r) => r.status === "proposed");
  const editable = (status: string) => draft && ["planned", "in_progress", "blocked"].includes(status);

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          {p.planStatus === "draft" ? (
            <Note>
              <strong>Draft plan.</strong> Change owners, quantities and tasks freely. When it looks right, send it to your partner. Once you both approve, it locks: later changes become proposals and
              adjustments that the other partner approves.
            </Note>
          ) : p.planStatus === "awaiting_partner" ? (
            <Note tone="waiting">
              <strong>Waiting for approval.</strong> {iApproved ? "You approved this plan. Your partner needs to approve it too." : "Your partner sent this plan. Approve it, or send it back with a reason."}
            </Note>
          ) : (
            <Note tone="verified">
              <strong>Plan locked by both partners.</strong> New tasks start as proposals (approved by the other partner, or automatically after 72 hours of silence). Change points or shares through an
              adjustment on the task page.
            </Note>
          )}
        </div>
        <div className="rounded-md border border-rule p-4">
          <h2 className="font-bold">Planned points</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex justify-between">
                <span>{m.name}</span>
                <span className="tabular-nums">
                  <Points value={v.perMember.get(m.id) ?? 0} /> ({total ? Math.round((100 * (v.perMember.get(m.id) ?? 0)) / total) : 0}%)
                </span>
              </li>
            ))}
            <li className="flex justify-between border-t border-rule pt-1 font-semibold">
              <span>Total</span>
              <Points value={total} />
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {p.planStatus === "draft" ? <ActionButton action={submitPlanAction.bind(null, projectId)} label="Send to partner to lock" size="md" /> : null}
            {p.planStatus === "awaiting_partner" && !iApproved ? <ActionButton action={approvePlanAction.bind(null, projectId)} label="Approve and lock" size="md" /> : null}
            {p.planStatus === "awaiting_partner" && iApproved && p.planSubmittedBy === me.id ? (
              <ActionButton action={withdrawPlanAction.bind(null, projectId)} label="Withdraw to edit" variant="secondary" size="md" />
            ) : null}
            {p.planStatus === "draft" ? (
              <ActionButton action={repinRulesAction.bind(null, projectId)} label="Use latest rules" variant="quiet" confirm="Move this project to the latest active rules version?" />
            ) : null}
          </div>
          {p.planStatus === "awaiting_partner" && !iApproved ? (
            <ActionForm action={rejectPlanAction.bind(null, projectId)} className="mt-3 space-y-2">
              <Field label="Or send it back">
                <input className="field-input" name="reason" placeholder="What should change?" required />
              </Field>
              <SubmitButton variant="secondary" size="sm">
                Send back
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </div>

      {proposals.length ? (
        <Section title="Proposed tasks" description="Added after the plan was locked. The other partner approves, or they approve themselves 72 hours after being proposed.">
          <ul className="divide-y divide-rule">
            {proposals.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-20 font-semibold">{t.code}</span>
                <Link href={`/projects/${projectId}/tasks/${t.id}`} className="min-w-0 flex-1 hover:underline">
                  {t.name}
                </Link>
                <span className="text-sm text-ink-soft">
                  <Points value={t.points} /> pts, by {names.get(t.proposedBy ?? 0) ?? "?"}
                </span>
                {t.proposedBy !== me.id ? <ActionButton action={approveProposalAction.bind(null, t.id)} label="Approve" /> : null}
                <ActionButton action={rejectProposalAction.bind(null, t.id)} label={t.proposedBy === me.id ? "Withdraw" : "Reject"} variant="danger" confirm="Cancel this proposed task?" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="mt-8">
        {phases.map((phase) => {
          const rows = v.rows.filter((r) => r.phase === phase && r.status !== "proposed");
          if (!rows.length) return null;
          const pts = rows.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.points, 0);
          return (
            <details key={phase} className="group mb-3 rounded-md border border-rule" open={phase === phases[0]}>
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 font-bold">
                <span>{PHASE_LABELS[phase as Phase] ?? phase}</span>
                <span className="text-sm font-normal text-ink-soft">
                  {rows.length} tasks, <Points value={pts} /> points
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-rule">
                <table className="ledger-table min-w-[48rem]">
                  <thead>
                    <tr>
                      <th className="w-20">Task</th>
                      <th>Name</th>
                      <th className="w-40">Owner</th>
                      <th className="num w-16">Qty</th>
                      <th className="num w-16">Factor</th>
                      <th className="num w-16">Points</th>
                      <th className="w-32">Status</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id} className={t.status === "cancelled" ? "text-ink-faint" : ""}>
                        <td className="font-semibold">{t.code}</td>
                        <td>
                          <Link href={`/projects/${projectId}/tasks/${t.id}`} className="hover:text-royal hover:underline">
                            {t.name}
                          </Link>
                          {t.classification === "MUST" ? null : <span className="ml-2 text-xs text-ink-faint">{t.classification}</span>}
                        </td>
                        <td>
                          {t.shares.length > 1 ? (
                            <span className="text-sm">{t.shares.map((s) => `${names.get(s.memberId)?.split(" ")[0]} ${s.shareBp / 100}%`).join(", ")}</span>
                          ) : (
                            <OwnerSelect action={setOwnerAction.bind(null, t.id)} members={members} value={t.shares[0]?.memberId ?? t.ownerMemberId} disabled={!editable(t.status)} label={`Owner of ${t.code}`} />
                          )}
                        </td>
                        <td className="num">
                          {t.quantity}
                          {t.unit ? <span className="block text-xs text-ink-faint">per {t.unit}</span> : null}
                        </td>
                        <td className="num">{t.adjustmentFactor === 1 ? "1" : t.adjustmentFactor.toFixed(2)}</td>
                        <td className="num font-semibold">
                          <Points value={t.points} />
                        </td>
                        <td>
                          <TaskStatus status={t.status} />
                        </td>
                        <td className="text-right">
                          {draft && t.status === "planned" ? <ActionButton action={removeTaskAction.bind(null, t.id)} label="Remove" variant="quiet" confirm={`Remove ${t.code} from the plan?`} /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>

      {p.closeStatus !== "closed_locked" ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Section title="Add from the library" description={p.planStatus === "locked" ? "Added tasks become proposals for your partner." : "Codes from the 343-task library, e.g. AS-02 for another revision round."}>
            <ActionForm action={addLibraryTasksAction.bind(null, projectId)} className="space-y-2" resetOnSuccess>
              <Field label="Task codes" hint="Separate several with commas. The same code twice adds a second copy (e.g. a third revision round).">
                <input className="field-input" name="codes" list="library-codes" placeholder="AS-02, AI-07" required />
              </Field>
              <datalist id="library-codes">
                {v.available.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name} ({a.points} pts){v.inPlan.has(a.code) ? " — already in plan" : ""}
                  </option>
                ))}
              </datalist>
              <SubmitButton variant="secondary">Add tasks</SubmitButton>
            </ActionForm>
          </Section>
          <Section title="Add a task that is not in the library" description="You set the points; your partner sees them before they count.">
            <ActionForm action={addCustomTaskAction.bind(null, projectId)} className="space-y-2" resetOnSuccess>
              <Field label="Task">
                <input className="field-input" name="name" required placeholder="Animated menu board for the café" />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Category">
                  <select className="field-input" name="category" defaultValue="V">
                    {v.categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Points">
                  <input className="field-input" name="points" inputMode="numeric" defaultValue="2" required />
                </Field>
                <Field label="Owner">
                  <select className="field-input" name="owner" defaultValue={me.id}>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <SubmitButton variant="secondary">Add task</SubmitButton>
            </ActionForm>
          </Section>
        </div>
      ) : null}
      {p.planStatus === "locked" ? (
        <p className="mt-2 text-sm text-ink-soft">
          <Pill tone="verified">Locked</Pill> on {p.planLockedAt?.slice(0, 10)}. Version of the task library: {p.libraryVersionId}.
        </p>
      ) : null}
    </>
  );
}
