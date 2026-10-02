import Link from "next/link";
import { isoDate } from "@/server/context";
import { notFound } from "next/navigation";
import { evidenceTypeLabel, EvidenceForm } from "@/components/evidence-form";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Field, formatDate, formatDateTime, KeyValue, Note, Pill, Points, Section, Stamp, TaskStatus } from "@/components/ui";
import { PHASE_LABELS, type Phase } from "@/domain/types";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { DomainError } from "@/server/errors";
import { memberNames } from "@/server/queries";
import { taskDetail } from "@/server/taskView";
import {
  addTaskEvidenceAction,
  approveAdjustmentAction,
  blockTaskAction,
  clientApprovalAction,
  disputeAdjustmentAction,
  disputeTaskAction,
  logTimeAction,
  rejectSubmissionAction,
  requestAdjustmentAction,
  reviewEvidenceAction,
  startTaskAction,
  submitTaskAction,
  unblockTaskAction,
  updateTaskPlanAction,
  verifyTaskAction,
  withdrawAdjustmentAction,
} from "./actions";

export default async function TaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const me = await requireMember();
  const { id, taskId } = await params;
  const db = getDb();
  let d: ReturnType<typeof taskDetail>;
  try {
    d = taskDetail(db, Number(taskId), me.id, new Date());
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const t = d.task;
  if (t.projectId !== Number(id)) notFound();
  const names = memberNames(db);
  const name = (mid: number | null | undefined) => (mid ? (names.get(mid) ?? `#${mid}`) : "—");
  const tpl = d.template;
  const today = isoDate(new Date());
  const pendingOnMe = d.adjustments.filter((a) => a.status === "requested" && a.requestedBy !== me.id);

  return (
    <article>
      <p className="text-sm text-ink-soft">
        <Link href={`/projects/${t.projectId}/board`} className="hover:underline">
          Board
        </Link>{" "}
        / {PHASE_LABELS[t.phase as Phase] ?? t.phase}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">
          {t.code} {t.name}
        </h2>
        <TaskStatus status={t.status} />
        {t.multiplier !== 1 ? <Pill tone="ledger">{t.multiplier === 0 ? "Points voided by dispute" : `Points × ${t.multiplier} after dispute`}</Pill> : null}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="min-w-0 space-y-6">
          {d.gate && t.status === "planned" ? (
            <Note tone="ledger">
              <strong>Blocked by {d.gate.milestoneName}.</strong> This work cannot start until {d.gate.missing.join(", ")} {d.gate.missing.length === 1 ? "is" : "are"} done.
            </Note>
          ) : null}
          {t.status === "submitted" && d.can.verify ? (
            <Note tone="waiting">
              <strong>Your check is needed.</strong> Open each evidence item; verify if it proves the work, or send it back with what is missing.
              {d.eligibility.mode === "joint" ? " Both partners contributed, so the partner who did not submit confirms it." : ""}
            </Note>
          ) : null}
          {t.rejectionReason && t.status === "in_progress" ? (
            <Note tone="ledger">
              <strong>Sent back:</strong> {t.rejectionReason}
            </Note>
          ) : null}
          {t.blockedReason && t.status === "blocked" ? (
            <Note tone="ledger">
              <strong>Blocked:</strong> {t.blockedReason}
            </Note>
          ) : null}

          <div className="flex flex-wrap items-start gap-2">
            {d.can.start ? <ActionButton action={startTaskAction.bind(null, t.id)} label="Start work" size="md" /> : null}
            {d.can.submit ? <ActionButton action={submitTaskAction.bind(null, t.id)} label="Submit for verification" size="md" /> : null}
            {d.can.unblock ? <ActionButton action={unblockTaskAction.bind(null, t.id)} label="Unblock" variant="secondary" size="md" /> : null}
            {d.can.verify ? (
              <ActionForm action={verifyTaskAction.bind(null, t.id)} className="flex items-start gap-2">
                <input className="field-input w-56" name="note" placeholder="Note (optional)" aria-label="Verification note" />
                <SubmitButton>Verify</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          {d.can.verify ? (
            <ActionForm action={rejectSubmissionAction.bind(null, t.id)} className="flex flex-wrap items-start gap-2">
              <input className="field-input max-w-md flex-1" name="reason" placeholder="What is missing?" required aria-label="Reason for sending back" />
              <SubmitButton variant="danger">Send back</SubmitButton>
            </ActionForm>
          ) : null}
          {d.can.block ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-ink-soft">Mark as blocked</summary>
              <ActionForm action={blockTaskAction.bind(null, t.id)} className="mt-2 flex flex-wrap items-start gap-2">
                <input className="field-input max-w-md flex-1" name="reason" placeholder="Waiting on client content, access…" required aria-label="Why it is blocked" />
                <SubmitButton variant="secondary">Mark blocked</SubmitButton>
              </ActionForm>
            </details>
          ) : null}

          <Section
            title="Evidence"
            description={
              t.status === "verified" || t.status === "locked"
                ? `Checked and verified by ${name(t.verifiedBy)}.`
                : t.status === "submitted"
                  ? `Submission ${t.submissionRound}. Items added after submitting count for the next submission.`
                  : d.evidenceStatus.ok
                    ? "Enough evidence to submit."
                    : (d.evidenceStatus.reason ?? "Add evidence before submitting.")
            }
          >
            {d.evidence.length ? (
              <ul className="mb-4 divide-y divide-rule">
                {d.evidence.map((e) => (
                  <li key={e.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{evidenceTypeLabel(e.type)}</span>
                      <Pill tone={e.strength === "strong" ? "verified" : e.strength === "medium" ? "royal" : "neutral"}>{e.strength}</Pill>
                      {e.verificationStatus === "accepted" ? <Stamp tone="verified">Accepted</Stamp> : e.verificationStatus === "rejected" ? <Stamp tone="ledger">Rejected</Stamp> : null}
                      <span className="text-sm text-ink-faint">
                        {name(e.submittedBy)}, {formatDateTime(e.submittedAt)}, for submission {e.submissionRound}
                      </span>
                    </div>
                    <p className="mt-1">{e.description}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold text-royal hover:underline">
                          {e.url}
                        </a>
                      ) : null}
                      {e.externalRef ? <span>Ref: {e.externalRef}</span> : null}
                      {e.file ? (
                        <a href={`/files/${e.file.id}`} className="font-semibold text-royal hover:underline">
                          {e.file.name}
                        </a>
                      ) : null}
                      {e.sha256 ? <span className="font-mono text-xs text-ink-faint">sha256 {e.sha256.slice(0, 16)}…</span> : null}
                    </div>
                    {e.rejectionReason ? <p className="mt-1 text-sm text-ledger">Rejected: {e.rejectionReason}</p> : null}
                    {e.verificationStatus === "pending" && e.submittedBy !== me.id && d.project.closeStatus !== "closed_locked" ? (
                      <ActionForm action={reviewEvidenceAction.bind(null, e.id)} className="mt-2 flex flex-wrap items-start gap-2">
                        <input className="field-input max-w-xs flex-1" name="reason" placeholder="Reason, if rejecting" aria-label="Reason" />
                        <SubmitButton variant="secondary" size="sm" name="decision" value="accept">
                          Accept
                        </SubmitButton>
                        <SubmitButton variant="danger" size="sm" name="decision" value="reject">
                          Reject
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {d.can.addEvidence ? (
              <EvidenceForm
                action={addTaskEvidenceAction.bind(null, t.id, t.projectId)}
                types={d.config.evidence_types}
                fileCategory={fileCategoryFor(t.phase)}
                hint={t.evidenceExpected ? `Expected: ${t.evidenceExpected}` : undefined}
              />
            ) : null}
          </Section>

          {t.clientApproval !== "No" ? (
            <Section title="Client approval" description={t.clientApproval === "Yes" ? "Needs the client's written approval before its milestone counts." : "Client approval is optional for this task."}>
              <KeyValue
                items={[
                  ["Status", d.approval?.status.replaceAll("_", " ") ?? "not recorded"],
                  ["Approved by", d.approval?.approvedByName || "—"],
                  ["When", formatDate(d.approval?.approvedAt)],
                  ["Channel", d.approval?.channel?.replaceAll("_", " ") ?? "—"],
                ]}
              />
              {d.can.clientApproval ? (
                <ActionForm action={clientApprovalAction.bind(null, t.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Field label="Status">
                    <select className="field-input" name="status" defaultValue={d.approval?.status ?? "pending"}>
                      {d.config.client_approval_status.map((s) => (
                        <option key={s} value={s}>
                          {s.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Approved by (client's name)">
                    <input className="field-input" name="approved_by" defaultValue={d.approval?.approvedByName ?? ""} />
                  </Field>
                  <Field label="Approved on">
                    <input className="field-input" type="date" name="approved_on" defaultValue={today} />
                  </Field>
                  <Field label="Channel" hint="WhatsApp only counts when confirmed by email">
                    <select className="field-input" name="channel" defaultValue={d.approval?.channel ?? "email"}>
                      {d.config.approval_channels.map((c) => (
                        <option key={c} value={c}>
                          {c.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <SubmitButton variant="secondary">Save approval</SubmitButton>
                  </div>
                </ActionForm>
              ) : null}
            </Section>
          ) : null}

          {d.can.editPlan ? (
            <Section title="Plan for this task" description="Editable while the plan is a draft and the task has not been submitted.">
              <ActionForm action={updateTaskPlanAction.bind(null, t.id)} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={`Quantity${t.unit ? ` (per ${t.unit})` : ""}`}>
                    <input className="field-input" name="quantity" defaultValue={t.quantity} inputMode="decimal" />
                  </Field>
                  <Field label="Adjustment factor" hint={`${d.config.calculation.adjustment_min}–${d.config.calculation.adjustment_max}`}>
                    <input className="field-input" name="factor" defaultValue={t.adjustmentFactor} inputMode="decimal" />
                  </Field>
                  <Field label="Notes">
                    <input className="field-input" name="notes" defaultValue={t.notes} />
                  </Field>
                </div>
                <fieldset>
                  <legend className="mb-1 text-sm font-semibold">Shares (%)</legend>
                  <div className="flex flex-wrap gap-3">
                    {d.members.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-sm">
                        {name(m)}
                        <input className="field-input w-20" name={`share_${m}`} inputMode="decimal" defaultValue={(d.shares.find((s) => s.memberId === m)?.shareBp ?? 0) / 100} />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="own_defect" defaultChecked={t.ownDefect} /> This fixes a defect in the doer&apos;s own verified work (earns 0 points)
                </label>
                <SubmitButton variant="secondary">Save plan</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}

          {d.adjustments.length || d.can.adjust ? (
            <Section title="Adjustments" description="After plan lock, points and shares change only when the other partner approves.">
              {d.adjustments.length ? (
                <ul className="mb-3 divide-y divide-rule">
                  {d.adjustments.map((a) => (
                    <li key={a.id} className="py-2 text-sm">
                      <span className="font-semibold">
                        {a.kind === "factor" ? `Factor → ${String(a.payload.factor)}` : a.kind === "quantity" ? `Quantity → ${String(a.payload.quantity)}` : a.kind === "shares" ? "New shares" : "Descope (cancel)"}
                      </span>{" "}
                      by {name(a.requestedBy)}: {a.reason} <Pill tone={a.status === "approved" ? "verified" : a.status === "requested" ? "waiting" : "neutral"}>{a.status}</Pill>
                      {a.status === "requested" && a.requestedBy !== me.id && d.project.closeStatus !== "closed_locked" ? (
                        <span className="ml-2 inline-flex flex-wrap gap-2 align-middle">
                          <ActionButton action={approveAdjustmentAction.bind(null, a.id)} label="Approve" />
                          <ActionButton action={disputeAdjustmentAction.bind(null, a.id)} label="Dispute" variant="danger" confirm="Open a dispute on this adjustment?" />
                        </span>
                      ) : null}
                      {a.status === "requested" && a.requestedBy === me.id ? <ActionButton action={withdrawAdjustmentAction.bind(null, a.id)} label="Withdraw" variant="quiet" /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {d.can.adjust && pendingOnMe.length === 0 ? (
                <details>
                <summary className="cursor-pointer text-sm font-semibold text-royal">Request an adjustment</summary>
                <ActionForm action={requestAdjustmentAction.bind(null, t.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label="Change">
                    <select className="field-input" name="kind" defaultValue="factor">
                      <option value="factor">Adjustment factor</option>
                      <option value="quantity">Quantity</option>
                      <option value="shares">Shares</option>
                      <option value="descope">Cancel this task (descope)</option>
                    </select>
                  </Field>
                  <Field label="New factor" hint={`Raising it needs logged hours above ${d.config.calculation.effort_adjustment_trigger_multiple}× the estimate`}>
                    <input className="field-input" name="factor" inputMode="decimal" defaultValue={t.adjustmentFactor} />
                  </Field>
                  <Field label="New quantity">
                    <input className="field-input" name="quantity" inputMode="decimal" defaultValue={t.quantity} />
                  </Field>
                  <fieldset>
                    <legend className="mb-1 text-sm font-semibold">New shares (%)</legend>
                    <div className="flex flex-wrap gap-2">
                      {d.members.map((m) => (
                        <label key={m} className="flex items-center gap-1 text-sm">
                          {name(m).split(" ")[0]}
                          <input className="field-input w-16" name={`share_${m}`} inputMode="decimal" defaultValue={(d.shares.find((s) => s.memberId === m)?.shareBp ?? 0) / 100} />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="sm:col-span-2">
                    <Field label="Reason">
                      <input className="field-input" name="reason" required placeholder="Client's legacy hosting took three extra days" />
                    </Field>
                  </div>
                  <div>
                    <SubmitButton variant="secondary">Ask partner to approve</SubmitButton>
                  </div>
                </ActionForm>
                </details>
              ) : null}
            </Section>
          ) : null}

          {d.disputes.length || d.can.dispute ? (
            <Section title="Disputes" description={d.windowEnds ? `Disputes can be raised until ${formatDate(d.windowEnds.toISOString())}.` : undefined}>
              {d.disputes.map((x) => (
                <p key={x.id} className="text-sm">
                  <Link href={`/projects/${t.projectId}/disputes#d${x.id}`} className="font-semibold text-royal hover:underline">
                    Dispute #{x.id}
                  </Link>{" "}
                  ({x.reasonCode.replaceAll("_", " ")}) — {x.status.replace("_", " ")}
                  {x.resolution ? `: ${x.resolution.replaceAll("_", " ")}` : ""}
                </p>
              ))}
              {d.can.dispute ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-ledger">Raise a dispute about this task</summary>
                  <ActionForm action={disputeTaskAction.bind(null, t.id, t.projectId)} className="mt-2 grid gap-2">
                    <Field label="Reason">
                      <select className="field-input" name="reason_code">
                        {d.config.dispute_reason_codes.map((c) => (
                          <option key={c} value={c}>
                            {c.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="What is wrong">
                      <textarea className="field-input" name="description" rows={2} required />
                    </Field>
                    <div>
                      <SubmitButton variant="danger">Raise dispute</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              ) : null}
            </Section>
          ) : null}

          <Section title="History">
            <ul className="space-y-1 text-sm">
              {d.history.map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span className="w-36 shrink-0 text-ink-faint">{formatDateTime(h.at)}</span>
                  <span>
                    <strong>{h.actorLabel}</strong> {h.action.split(".")[1]?.replaceAll("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="space-y-6">
          <div className="rounded-md border border-rule p-4">
            <p className="text-sm text-ink-soft">Points if verified</p>
            <p className="text-3xl font-bold tabular-nums">
              <Points value={d.planned} />
            </p>
            <p className="text-sm text-ink-soft">
              {t.defaultPoints} × {t.quantity}
              {t.unit ? ` ${t.unit}` : ""}
              {t.adjustmentFactor !== 1 ? ` × ${t.adjustmentFactor}` : ""}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {d.shares.map((s) => (
                <li key={s.memberId} className="flex justify-between">
                  <span>{name(s.memberId)}</span>
                  <span className="tabular-nums">{s.shareBp / 100}%</span>
                </li>
              ))}
            </ul>
          </div>
          <KeyValue
            items={[
              ["Classification", t.classification],
              ["Complexity", t.complexity],
              ["Typical effort", tpl?.effortRange ?? "—"],
              ["Client approval", t.clientApproval],
              ["Submitted", t.submittedAt ? `${formatDateTime(t.submittedAt)} by ${name(t.submittedBy)}` : "—"],
              ["Verified", t.verifiedAt ? `${formatDateTime(t.verifiedAt)} by ${name(t.verifiedBy)}` : "—"],
            ]}
          />
          {d.deps.length ? (
            <div>
              <p className="mb-1 text-sm font-semibold">Depends on</p>
              <ul className="space-y-1 text-sm">
                {d.deps.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2">
                    <Link href={`/projects/${t.projectId}/tasks/${x.id}`} className="hover:underline">
                      {x.code} {x.name}
                    </Link>
                    <TaskStatus status={x.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="mb-1 text-sm font-semibold">Time logged</p>
            {Object.entries(d.minutesByMember).length ? (
              <ul className="text-sm">
                {Object.entries(d.minutesByMember).map(([m, mins]) => (
                  <li key={m} className="flex justify-between">
                    <span>{name(Number(m))}</span>
                    <span className="tabular-nums">{(mins / 60).toFixed(1)} h</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint">None yet. Time is for calibration, never for pay.</p>
            )}
            {d.can.logTime ? (
              <ActionForm action={logTimeAction.bind(null, t.id)} className="mt-2 grid grid-cols-2 gap-2" resetOnSuccess>
                <input className="field-input" type="date" name="work_date" defaultValue={today} aria-label="Date" required />
                <input className="field-input" name="hours" inputMode="decimal" placeholder="Hours" aria-label="Hours" required />
                <input className="field-input col-span-2" name="note" placeholder="Note (optional)" aria-label="Note" />
                <SubmitButton variant="secondary" size="sm">
                  Log time
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          {tpl ? (
            <details className="rounded-md border border-rule p-3 text-sm" open>
              <summary className="cursor-pointer font-semibold">Guidance from the library</summary>
              <div className="mt-2 space-y-2">
                <p>{t.description}</p>
                {tpl.why ? (
                  <p>
                    <strong>Why:</strong> {tpl.why}
                  </p>
                ) : null}
                <p>
                  <strong>Deliverable:</strong> {t.deliverable}
                </p>
                <p>
                  <strong>Risks:</strong> {tpl.risks}
                </p>
                <p>
                  <strong>Common mistakes:</strong> {tpl.commonMistakes}
                </p>
                <p>
                  <strong>If skipped:</strong> {tpl.ifSkipped}
                </p>
              </div>
            </details>
          ) : t.description ? (
            <p className="text-sm">{t.description}</p>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function fileCategoryFor(phase: string): string {
  const map: Record<string, string> = {
    presales: "01_contract",
    contract: "01_contract",
    discovery: "02_brief",
    research: "02_brief",
    content: "03_content",
    design: "04_design",
    development: "05_dev",
    kickoff: "05_dev",
    qa: "06_qa",
    review: "06_qa",
    launch: "07_launch",
    handover: "08_handover",
    closure: "11_internal",
    throughout: "10_comms",
  };
  return map[phase] ?? "11_internal";
}
