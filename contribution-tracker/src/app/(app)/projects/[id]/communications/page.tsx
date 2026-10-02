import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { evidenceTypeLabel, EvidenceForm } from "@/components/evidence-form";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Field, formatDateTime, Note, Pill, Section, Stamp } from "@/components/ui";
import { communicationAwards, communicationQualifies } from "@/domain/communication";
import { getDb } from "@/db";
import { actionItems, communications, evidence, taskInstances } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { istNowLocal } from "@/lib/form";
import { canVerifyCommunication } from "@/server/communications";
import { projectHeader } from "@/server/queries";
import {
  addCommunicationEvidenceAction,
  cancelCommunicationAction,
  logCommunicationAction,
  planCommunicationAction,
  rejectCommunicationAction,
  verifyCommunicationAction,
} from "./actions";

export const metadata = { title: "Communications" };

export default async function CommunicationsPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, members, config } = projectHeader(db, projectId);
  const open = p.closeStatus !== "closed_locked";
  const rows = db.select().from(communications).where(eq(communications.projectId, projectId)).orderBy(desc(communications.id)).all();
  const name = (id: number | null) => members.find((m) => m.id === id)?.name ?? "—";
  const typeOf = (code: string) => config.communication_types.find((c) => c.code === code);
  const cats = config.categories;

  const LogFields = ({ planned }: { planned?: (typeof rows)[number] }) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {!planned ? (
        <>
          <Field label="Type">
            <select className="field-input" name="type" defaultValue="video_meeting">
              {config.communication_types.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.lead_points} pt lead)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Led by">
            <select className="field-input" name="lead" defaultValue={me.id}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      <Field label="When">
        <input className="field-input" type="datetime-local" name="occurred_at" defaultValue={istNowLocal()} required />
      </Field>
      <Field label="Channel">
        <select className="field-input" name="channel" defaultValue={planned?.channel ?? "video"}>
          {config.communication_channels.map((c) => (
            <option key={c} value={c}>
              {c.replace("_", " ")}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Minutes" hint="Optional">
        <input className="field-input" name="duration" inputMode="numeric" />
      </Field>
      <Field label="Client attendees">
        <input className="field-input" name="client_attendees" placeholder="Owner, manager" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Summary">
          <textarea className="field-input" name="summary" rows={2} required />
        </Field>
      </div>
      <Field label="Decisions" hint="One per line. A communication earns points only with a decision or an action item.">
        <textarea className="field-input" name="decisions" rows={3} />
      </Field>
      <div className="space-y-2">
        <Field label="Action items" hint="One per line. Each becomes a task (a proposal once the plan is locked).">
          <textarea className="field-input" name="action_items" rows={3} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <select className="field-input" name="action_category" defaultValue="K" aria-label="Category for action items">
            {cats.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
          <select className="field-input" name="action_owner" defaultValue={planned?.leadMemberId ?? me.id} aria-label="Owner of action items">
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="notes_sent" /> Notes were sent to the client (attach them as evidence below after saving)
      </label>
    </div>
  );

  return (
    <>
      <Note>
        A meeting or call earns its fixed points (shown next to each type) when it has a summary, at least one decision or action item, and the notes you sent or a meeting record as evidence —
        and your partner has verified it. Communication is capped at {Math.round(config.calculation.communication_cap_pct * 100)}% of a project&apos;s points. A second attendee earns points only
        when marked required while planning the meeting.
      </Note>
      {open ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Section title="Log a communication">
            <ActionForm action={logCommunicationAction.bind(null, projectId, null)} className="space-y-3" resetOnSuccess>
              <LogFields />
              <Field label="Other partner present" hint="Recorded, but earns no points unless planned as required">
                <select className="field-input" name="second" defaultValue="">
                  <option value="">Nobody</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <SubmitButton>Log it</SubmitButton>
            </ActionForm>
          </Section>
          <Section title="Plan a meeting" description="Plan ahead when both partners need to attend, so the second attendee earns points.">
            <ActionForm action={planCommunicationAction.bind(null, projectId)} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
              <Field label="Type">
                <select className="field-input" name="type" defaultValue="discovery_call">
                  {config.communication_types.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="When">
                <input className="field-input" type="datetime-local" name="scheduled_for" required />
              </Field>
              <Field label="Led by">
                <select className="field-input" name="lead" defaultValue={me.id}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Second attendee">
                <select className="field-input" name="second" defaultValue="">
                  <option value="">Nobody</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="second_required" /> The second attendee is required (earns second-attendee points)
              </label>
              <div>
                <SubmitButton variant="secondary">Plan it</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        </div>
      ) : null}

      <Section title="All communications">
        {rows.length === 0 ? (
          <Empty title="Nothing logged yet">Log calls and meetings as they happen. Action items become tasks automatically.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {rows.map((c) => {
              const type = typeOf(c.type);
              const ev = db.select().from(evidence).where(and(eq(evidence.subjectType, "communication"), eq(evidence.subjectId, c.id))).all();
              const items = db.select({ a: actionItems, t: taskInstances }).from(actionItems).leftJoin(taskInstances, eq(taskInstances.id, actionItems.taskInstanceId)).where(eq(actionItems.communicationId, c.id)).all();
              const qualifies = communicationQualifies({ summary: c.summary, decisions: c.decisions, actionItemCount: items.length, evidenceTypes: ev.filter((e) => e.verificationStatus !== "rejected").map((e) => e.type) });
              const awards = type ? communicationAwards({ leadMemberId: c.leadMemberId, secondMemberId: c.secondMemberId, secondRequired: c.secondRequired, multiplier: c.multiplier, splitParties: c.splitParties ?? null }, type) : [];
              const canVerify = open && canVerifyCommunication(db, c, me.id);
              return (
                <li key={c.id} id={`c${c.id}`} className="scroll-mt-6 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{type?.name ?? c.type}</span>
                    {c.status === "verified" ? <Stamp tone="verified">Verified</Stamp> : c.status === "planned" ? <Pill tone="royal">Planned</Pill> : c.status === "logged" ? <Pill tone="waiting">Awaiting check</Pill> : <Pill tone="neutral">{c.status}</Pill>}
                    <span className="text-sm text-ink-soft">
                      {formatDateTime(c.occurredAt ?? c.scheduledFor)}, led by {name(c.leadMemberId)}
                      {c.secondMemberId ? ` with ${name(c.secondMemberId)}${c.secondRequired ? " (required)" : ""}` : ""}
                    </span>
                  </div>
                  {c.summary ? <p className="mt-1">{c.summary}</p> : null}
                  {c.decisions.length ? (
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {c.decisions.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                  {items.length ? (
                    <p className="mt-1 text-sm">
                      Action items:{" "}
                      {items.map((x, i) => (
                        <span key={x.a.id}>
                          {i ? ", " : ""}
                          {x.t ? (
                            <Link href={`/projects/${projectId}/tasks/${x.t.id}`} className="font-semibold text-royal hover:underline">
                              {x.t.code} {x.a.text}
                            </Link>
                          ) : (
                            x.a.text
                          )}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {c.status !== "planned" && c.status !== "cancelled" ? (
                    <p className="mt-1 text-sm">
                      {qualifies ? (
                        <span className="text-verified">Earns {awards.map((a) => `${name(a.memberId).split(" ")[0]} ${a.points}`).join(", ")} point(s) once verified.</span>
                      ) : (
                        <span className="text-waiting">No points yet: needs a summary, a decision or action item, and the notes or a meeting record as evidence.</span>
                      )}
                    </p>
                  ) : null}
                  {ev.length ? (
                    <ul className="mt-1 text-sm">
                      {ev.map((e) => (
                        <li key={e.id}>
                          {evidenceTypeLabel(e.type)}: {e.description}{" "}
                          {e.url ? (
                            <a className="font-semibold text-royal hover:underline" href={e.url} target="_blank" rel="noopener noreferrer nofollow">
                              open
                            </a>
                          ) : null}
                          {e.fileId ? (
                            <a className="ml-1 font-semibold text-royal hover:underline" href={`/files/${e.fileId}`}>
                              file
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    {canVerify ? <ActionButton action={verifyCommunicationAction.bind(null, c.id)} label="Verify" /> : null}
                    {c.status === "planned" && open ? <ActionButton action={cancelCommunicationAction.bind(null, c.id)} label="Cancel" variant="quiet" confirm="Cancel this planned meeting?" /> : null}
                  </div>
                  {canVerify ? (
                    <ActionForm action={rejectCommunicationAction.bind(null, c.id)} className="mt-2 flex flex-wrap gap-2">
                      <input className="field-input max-w-sm flex-1" name="reason" placeholder="Why it should not count" required aria-label="Reason" />
                      <SubmitButton variant="danger" size="sm">
                        Reject
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {c.status === "planned" && open ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-semibold text-royal">Log what happened</summary>
                      <ActionForm action={logCommunicationAction.bind(null, projectId, c.id)} className="mt-2 space-y-3">
                        <LogFields planned={c} />
                        <SubmitButton>Log it</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : null}
                  {c.status === "logged" && open ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-semibold text-royal">Add notes or a meeting record</summary>
                      <div className="mt-2">
                        <EvidenceForm action={addCommunicationEvidenceAction.bind(null, c.id, projectId)} types={config.evidence_types} defaultType="meeting_notes_sent" fileCategory="10_comms" />
                      </div>
                    </details>
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
