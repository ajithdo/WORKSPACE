import Link from "next/link";
import { isoDate } from "@/server/context";
import { eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, formatDate, KeyValue, Money, Note, Points, Section } from "@/components/ui";
import { getDb } from "@/db";
import { configVersions, taskInstances } from "@/db/schema";
import { INDIAN_STATES, stateName } from "@/lib/states";
import { requireMember } from "@/lib/session";
import { loadProject } from "@/server/common";
import { plannedTotal } from "@/server/contribution";
import { financeSummary } from "@/server/finance";
import { projectMilestones } from "@/server/milestones";
import { memberNames, projectHeader } from "@/server/queries";
import { updateClientAction, updateDetailsAction } from "./actions";

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, client, members, config } = projectHeader(db, projectId);
  const tasks = db.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const live = tasks.filter((t) => t.status !== "cancelled" && t.status !== "proposed");
  const verifiedPts = live.filter((t) => t.status === "verified" || t.status === "locked").reduce((s, t) => s + t.defaultPoints * t.quantity * t.adjustmentFactor, 0);
  const milestones = p.kind === "client" ? projectMilestones(db, loadProject(db, projectId)) : [];
  const fin = financeSummary(db, projectId, isoDate(new Date()));
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
                ["Rules version", `v${db.select({ v: configVersions.version }).from(configVersions).where(eq(configVersions.id, p.configVersionId)).get()?.v ?? "?"}`],
              ]}
            />
            {p.closeStatus === "open" ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-royal">Edit project details</summary>
                <ActionForm action={updateDetailsAction.bind(null, projectId, p.planStatus === "draft")} className="mt-3 grid gap-3 text-sm">
                  <Field label="Project name">
                    <input className="field-input" name="name" defaultValue={p.name} required />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Start">
                      <input className="field-input" type="date" name="start_date" defaultValue={p.startDate ?? ""} />
                    </Field>
                    <Field label="Target launch">
                      <input className="field-input" type="date" name="target_launch_date" defaultValue={p.targetLaunchDate ?? ""} />
                    </Field>
                  </div>
                  <Field label="Place of supply" hint="The client's state decides CGST+SGST or IGST.">
                    <select className="field-input" name="place_of_supply" defaultValue={p.placeOfSupplyState}>
                      <option value="">Not set</option>
                      {INDIAN_STATES.map((st) => (
                        <option key={st.code} value={st.code}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quoted amount before GST (₹)">
                    <input className="field-input" name="quoted" inputMode="decimal" defaultValue={String(p.quotedAmountExGst / 100)} />
                  </Field>
                  <Field label="Brought in by" hint={p.planStatus === "draft" ? undefined : "Fixed once the plan is locked."}>
                    <select className="field-input" name="originated_by" defaultValue={p.originatedBy ? String(p.originatedBy) : ""} disabled={p.planStatus !== "draft"}>
                      <option value="">Nobody</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <fieldset className="grid gap-1.5">
                    <legend className="mb-1 font-semibold">Payment schedule (must add up to 100%)</legend>
                    {Array.from({ length: 6 }, (_, i) => {
                      const e = p.paymentSchedule[i];
                      return (
                        <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-1.5">
                          <input className="field-input" name={`pct_${i}`} inputMode="decimal" defaultValue={e ? String(e.pct) : ""} placeholder="%" aria-label={`Payment ${i + 1} percent`} />
                          <select className="field-input" name={`ms_${i}`} defaultValue={e?.milestoneCode ?? ""} aria-label={`Payment ${i + 1} milestone`}>
                            <option value="">No milestone</option>
                            {config.milestones.map((m) => (
                              <option key={m.code} value={m.code}>
                                {m.code} {m.name}
                              </option>
                            ))}
                          </select>
                          <input className="field-input col-span-2" name={`note_${i}`} defaultValue={e?.note ?? ""} placeholder="Note, e.g. advance on signing" aria-label={`Payment ${i + 1} note`} />
                        </div>
                      );
                    })}
                  </fieldset>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="msme" defaultChecked={p.msmeApplicable} className="mt-1" /> MSME 45-day payment rule applies
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="deemed_clause" defaultChecked={p.deemedAcceptanceClause} className="mt-1" /> The contract has a deemed-acceptance clause
                  </label>
                  <Field label="Deemed acceptance after (days)">
                    <input className="field-input w-28" name="deemed_days" inputMode="numeric" defaultValue={p.deemedAcceptanceDays ?? ""} />
                  </Field>
                  <Field label="Notes">
                    <textarea className="field-input" name="notes" rows={3} defaultValue={p.notes} />
                  </Field>
                  <div>
                    <SubmitButton variant="secondary">Save details</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : null}
            {client ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-royal">Edit client details</summary>
                <ActionForm action={updateClientAction.bind(null, client.id)} className="mt-3 grid gap-3 text-sm">
                  <Field label="Business name">
                    <input className="field-input" name="business_name" defaultValue={client.businessName} required />
                  </Field>
                  <Field label="Billing address" hint="Printed on invoices and quotations.">
                    <textarea className="field-input" name="address" rows={3} defaultValue={client.address} />
                  </Field>
                  <Field label="State">
                    <select className="field-input" name="state_code" defaultValue={client.stateCode}>
                      <option value="">Not set</option>
                      {INDIAN_STATES.map((st) => (
                        <option key={st.code} value={st.code}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="GSTIN" hint="Leave empty for an unregistered client.">
                    <input className="field-input uppercase" name="gstin" maxLength={15} defaultValue={client.gstin} />
                  </Field>
                  <Field label="Contact person">
                    <input className="field-input" name="contact_name" defaultValue={client.contactName} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Email">
                      <input className="field-input" type="email" name="contact_email" defaultValue={client.contactEmail} />
                    </Field>
                    <Field label="Phone / WhatsApp">
                      <input className="field-input" type="tel" name="contact_phone" defaultValue={client.contactPhone} />
                    </Field>
                  </div>
                  <p className="text-xs text-ink-faint">Changes apply to every project for this client. Issued invoices keep their number and amounts.</p>
                  <div>
                    <SubmitButton variant="secondary">Save client</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : null}
          </Section>
        </aside>
      </div>
    </>
  );
}
