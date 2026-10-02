import Link from "next/link";
import { isoDate } from "@/server/context";
import { desc, eq } from "drizzle-orm";
import { EvidenceForm } from "@/components/evidence-form";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Field, formatDate, Money, Note, Pill, Section } from "@/components/ui";
import { getDb } from "@/db";
import { changeRequests, taskInstances } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { evidenceFor } from "@/server/evidence";
import { projectHeader } from "@/server/queries";
import { advanceCrAction, assessCrAction, crEvidenceAction, crInvoiceAction, crTaskAction, logCrAction } from "./actions";

export const metadata = { title: "Change requests" };

const STATUS_TONE: Record<string, "neutral" | "royal" | "waiting" | "verified" | "ledger"> = {
  logged: "neutral",
  assessed: "royal",
  quoted: "waiting",
  approved: "verified",
  declined: "ledger",
  done: "verified",
  invoiced: "verified",
};

export default async function ChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, members, config } = projectHeader(db, projectId);
  const open = p.closeStatus !== "closed_locked";
  const rows = db.select().from(changeRequests).where(eq(changeRequests.projectId, projectId)).orderBy(desc(changeRequests.id)).all();
  const today = isoDate(new Date());
  return (
    <>
      <Note>
        Do not say yes or no on the spot. Log the request, classify it (a bug in agreed scope is free, a revision uses a round, a change is new work), assess the effort and price, and get the
        client&apos;s written approval before anyone starts. The person who assesses earns points even if the client declines.
      </Note>
      {open ? (
        <Section title="Log a request">
          <ActionForm action={logCrAction.bind(null, projectId)} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
            <div className="sm:col-span-2">
              <Field label="What the client asked for">
                <textarea className="field-input" name="description" rows={2} required />
              </Field>
            </div>
            <Field label="Asked by">
              <input className="field-input" name="requested_by" placeholder="Client's name" />
            </Field>
            <Field label="Asked on">
              <input className="field-input" type="date" name="requested_at" defaultValue={today} required />
            </Field>
            <Field label="First impression">
              <select className="field-input" name="classification" defaultValue="change">
                <option value="change">New work (priced)</option>
                <option value="revision">Revision (uses a round)</option>
                <option value="bug">Bug in agreed scope (free)</option>
              </select>
            </Field>
            <div className="self-end">
              <SubmitButton>Log request</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : null}
      <Section title="Requests">
        {rows.length === 0 ? (
          <Empty title="No change requests">Requests logged here keep scope creep visible and priced.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {rows.map((c) => {
              const tasks = db.select().from(taskInstances).where(eq(taskInstances.changeRequestId, c.id)).all();
              const ev = evidenceFor(db, "change_request", c.id);
              return (
                <li key={c.id} className="space-y-2 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{c.number}</span>
                    <Pill tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Pill>
                    <Pill>{c.classification}</Pill>
                    <span className="text-sm text-ink-soft">
                      {formatDate(c.requestedAt)}
                      {c.requestedByClientName ? ` by ${c.requestedByClientName}` : ""}
                    </span>
                  </div>
                  <p>{c.description}</p>
                  {c.status !== "logged" ? (
                    <p className="text-sm text-ink-soft">
                      Estimate {c.estimateHours ?? "?"} h, price <Money paise={c.priceExGst} /> + GST{c.noCharge ? " (goodwill, no charge)" : ""}, launch moves by {c.timelineImpactDays} day(s)
                    </p>
                  ) : null}
                  {tasks.length ? (
                    <p className="text-sm">
                      Work:{" "}
                      {tasks.map((t, i) => (
                        <span key={t.id}>
                          {i ? ", " : ""}
                          <Link className="font-semibold text-royal hover:underline" href={`/projects/${projectId}/tasks/${t.id}`}>
                            {t.code} {t.name}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {ev.length ? <p className="text-sm text-verified">Approval on record: {ev.map((e) => e.description).join("; ")}</p> : null}
                  {open ? (
                    <div className="flex flex-wrap gap-2">
                      {c.status === "assessed" ? <ActionButton action={advanceCrAction.bind(null, c.id, "quoted")} label="Mark quote sent" variant="secondary" /> : null}
                      {(c.status === "quoted" || c.status === "assessed") ? <ActionButton action={advanceCrAction.bind(null, c.id, "approved")} label="Client approved" /> : null}
                      {c.status === "approved" ? <ActionButton action={advanceCrAction.bind(null, c.id, "done")} label="Mark done" variant="secondary" /> : null}
                      {["logged", "assessed", "quoted"].includes(c.status) ? <ActionButton action={advanceCrAction.bind(null, c.id, "declined")} label="Declined" variant="danger" confirm="Mark this request as declined?" /> : null}
                    </div>
                  ) : null}
                  {open && ["logged", "assessed"].includes(c.status) ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-royal">Assess impact</summary>
                      <ActionForm action={assessCrAction.bind(null, c.id)} className="mt-2 grid gap-2 sm:grid-cols-3">
                        <Field label="Classification">
                          <select className="field-input" name="classification" defaultValue={c.classification}>
                            <option value="change">New work</option>
                            <option value="revision">Revision</option>
                            <option value="bug">Bug</option>
                          </select>
                        </Field>
                        <Field label="Hours">
                          <input className="field-input" name="hours" inputMode="decimal" defaultValue={c.estimateHours ?? ""} required />
                        </Field>
                        <Field label="Price before GST (₹)">
                          <input className="field-input" name="price" inputMode="decimal" />
                        </Field>
                        <Field label="Launch delay (days)">
                          <input className="field-input" name="days" inputMode="numeric" defaultValue={c.timelineImpactDays} />
                        </Field>
                        <label className="flex items-center gap-2 self-end text-sm">
                          <input type="checkbox" name="no_charge" /> Goodwill, no charge
                        </label>
                        <div className="self-end">
                          <SubmitButton variant="secondary">Save assessment</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  ) : null}
                  {open && ["assessed", "quoted"].includes(c.status) ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-royal">Attach the client&apos;s approval</summary>
                      <div className="mt-2">
                        <EvidenceForm action={crEvidenceAction.bind(null, c.id, projectId)} types={config.evidence_types} defaultType="client_approval" fileCategory="10_comms" />
                      </div>
                    </details>
                  ) : null}
                  {open && ["assessed", "quoted", "approved"].includes(c.status) ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-royal">Add the work as a task</summary>
                      <ActionForm action={crTaskAction.bind(null, c.id)} className="mt-2 grid gap-2 sm:grid-cols-4" resetOnSuccess>
                        <div className="sm:col-span-2">
                          <Field label="Task">
                            <input className="field-input" name="name" defaultValue={c.description.slice(0, 120)} required />
                          </Field>
                        </div>
                        <Field label="Category">
                          <select className="field-input" name="category" defaultValue="V">
                            {config.categories.map((cat) => (
                              <option key={cat.code} value={cat.code}>
                                {cat.code} {cat.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Points">
                          <input className="field-input" name="points" inputMode="numeric" defaultValue={Math.max(1, Math.round(c.estimateHours ?? 1))} />
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
                        <div className="self-end">
                          <SubmitButton variant="secondary">Add task</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  ) : null}
                  {open && ["approved", "done"].includes(c.status) && c.priceExGst > 0 && !c.invoiceId ? (
                    <ActionForm action={crInvoiceAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                      <Field label="Invoice date">
                        <input className="field-input" type="date" name="issue_date" defaultValue={today} />
                      </Field>
                      <Field label="Due">
                        <input className="field-input" type="date" name="due_date" defaultValue={today} />
                      </Field>
                      <SubmitButton variant="secondary">Create invoice</SubmitButton>
                    </ActionForm>
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
