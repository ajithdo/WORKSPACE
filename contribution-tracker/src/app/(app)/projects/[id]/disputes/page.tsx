import { and, asc, desc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Field, formatDate, formatDateTime, Note, Pill, Section } from "@/components/ui";
import { getDb } from "@/db";
import { communications, disputeComments, disputes, expenses } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { disputeParties } from "@/server/disputes";
import { projectHeader } from "@/server/queries";
import { acceptAction, commentAction, escalateAction, proposeAction, raiseDisputeAction } from "./actions";

export const metadata = { title: "Disputes" };

const TONE: Record<string, "ledger" | "waiting" | "verified" | "royal"> = { open: "ledger", in_discussion: "waiting", escalated: "royal", resolved: "verified" };

export default async function DisputesPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, members, config } = projectHeader(db, projectId);
  const open = p.closeStatus !== "closed_locked";
  const rows = db.select().from(disputes).where(eq(disputes.projectId, projectId)).orderBy(desc(disputes.id)).all();
  const name = (id: number | null) => members.find((m) => m.id === id)?.name ?? "system";
  const verifiedComms = db.select().from(communications).where(and(eq(communications.projectId, projectId), eq(communications.status, "verified"))).all();
  const approvedExpenses = db.select().from(expenses).where(and(eq(expenses.projectId, projectId), eq(expenses.status, "approved"))).all();
  const days = config.calculation.dispute_window_days;
  return (
    <>
      <Note>
        Raise a dispute within {days} days of verification and before the project is locked. While it is open, the item&apos;s points (or money) are held out of the split. Resolve it together:
        one partner proposes, the other accepts. Unresolved after {config.calculation.dispute_default_resolution_days} days, it is split 50/50 — unless either partner escalates to the external step
        in your partnership deed (CA or mediator). Three disputes on one project add a mandatory retrospective item.
      </Note>
      {open ? (
        <Section title="Raise a dispute" description="For a task, use the task's own page. Here: meetings, expenses and the plan.">
          <ActionForm action={raiseDisputeAction.bind(null, projectId)} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
            <Field label="About">
              <select className="field-input" name="target" required>
                {p.planStatus === "locked" ? <option value={`plan:${projectId}`}>The project plan</option> : null}
                {verifiedComms.map((c) => (
                  <option key={c.id} value={`communication:${c.id}`}>
                    Meeting: {c.type.replaceAll("_", " ")} on {c.occurredAt?.slice(0, 10)}
                  </option>
                ))}
                {approvedExpenses.map((e) => (
                  <option key={e.id} value={`expense:${e.id}`}>
                    Expense: {e.vendor} ({(e.amount / 100).toFixed(2)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason">
              <select className="field-input" name="reason_code">
                {config.dispute_reason_codes.map((c) => (
                  <option key={c} value={c}>
                    {c.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What is wrong">
              <input className="field-input" name="description" required />
            </Field>
            <div>
              <SubmitButton variant="danger">Raise dispute</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : null}
      <Section title="Disputes">
        {rows.length === 0 ? (
          <Empty title="No disputes">Good. Disputes stay on record permanently once raised.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {rows.map((d) => {
              const comments = db.select().from(disputeComments).where(eq(disputeComments.disputeId, d.id)).orderBy(asc(disputeComments.id)).all();
              const parties = disputeParties(db, d);
              const isParty = parties.includes(me.id);
              const active = d.status !== "resolved";
              return (
                <li key={d.id} id={`d${d.id}`} className="scroll-mt-6 space-y-2 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">Dispute #{d.id}</span>
                    <Pill tone={TONE[d.status] ?? "waiting"}>{d.status.replace("_", " ")}</Pill>
                    <span className="text-sm text-ink-soft">
                      {d.targetType.replace("_instance", "")} #{d.targetId}, {d.reasonCode.replaceAll("_", " ")}, raised by {name(d.raisedBy)} on {formatDate(d.raisedAt)}
                    </span>
                  </div>
                  <p>{d.description}</p>
                  {d.status === "resolved" ? (
                    <p className="text-sm text-verified">
                      Resolved: {d.resolution?.replaceAll("_", " ")}
                      {d.resolvedByBoth ? " (agreed by both)" : ` (${d.resolutionNote})`}
                    </p>
                  ) : (
                    <p className="text-sm text-ink-soft">
                      {d.status === "escalated" ? `Escalated by ${name(d.escalatedBy)}: ${d.escalationNote}` : `Defaults to a 50/50 split on ${formatDate(d.defaultDueAt)} if not resolved.`}
                    </p>
                  )}
                  {comments.length ? (
                    <ul className="space-y-1 border-l-2 border-rule pl-3 text-sm">
                      {comments.map((c) => (
                        <li key={c.id}>
                          <strong>{name(c.memberId)}</strong> <span className="text-ink-faint">{formatDateTime(c.createdAt)}</span>: {c.body}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {d.proposedResolution && active ? (
                    <p className="text-sm">
                      Proposed by {name(d.proposedBy)}: <strong>{d.proposedResolution.replaceAll("_", " ")}</strong>
                      {d.proposedPayload?.sharesBp
                        ? ` (${Object.entries(d.proposedPayload.sharesBp as Record<string, number>)
                            .map(([m, bp]) => `${name(Number(m))} ${bp / 100}%`)
                            .join(", ")})`
                        : d.proposedPayload?.factor
                          ? ` (factor ${String(d.proposedPayload.factor)})`
                          : ""}
                    </p>
                  ) : null}
                  {active && open && isParty ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {d.proposedResolution && d.proposedBy !== me.id ? <ActionButton action={acceptAction.bind(null, d.id)} label="Accept this resolution" /> : null}
                      </div>
                      <ActionForm action={commentAction.bind(null, d.id)} className="flex flex-wrap gap-2" resetOnSuccess>
                        <input className="field-input max-w-md flex-1" name="body" placeholder="Add to the discussion" required aria-label="Comment" />
                        <SubmitButton variant="secondary" size="sm">
                          Comment
                        </SubmitButton>
                      </ActionForm>
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold text-royal">Propose a resolution</summary>
                        <ActionForm action={proposeAction.bind(null, d.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                          <Field label="Resolution">
                            <select className="field-input" name="resolution">
                              {config.dispute_resolutions.map((r) => (
                                <option key={r} value={r}>
                                  {r.replaceAll("_", " ")}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="New factor (for change adjustment)">
                            <input className="field-input" name="factor" inputMode="decimal" defaultValue="1" />
                          </Field>
                          <fieldset className="sm:col-span-2">
                            <legend className="mb-1 text-sm font-semibold">New shares % (for change shares)</legend>
                            <div className="flex flex-wrap gap-3">
                              {members.map((m) => (
                                <label key={m.id} className="flex items-center gap-1 text-sm">
                                  {m.name}
                                  <input className="field-input w-20" name={`share_${m.id}`} inputMode="decimal" defaultValue={Math.round(100 / members.length)} />
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <div className="sm:col-span-2">
                            <Field label="Note">
                              <input className="field-input" name="note" />
                            </Field>
                          </div>
                          <div>
                            <SubmitButton variant="secondary">Propose</SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                      {d.status !== "escalated" ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-ink-soft">Escalate to the external step in the deed</summary>
                          <ActionForm action={escalateAction.bind(null, d.id)} className="mt-2 flex flex-wrap gap-2">
                            <input className="field-input max-w-md flex-1" name="note" placeholder="Taking this to our CA on …" required aria-label="Escalation note" />
                            <SubmitButton variant="secondary" size="sm">
                              Escalate
                            </SubmitButton>
                          </ActionForm>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
