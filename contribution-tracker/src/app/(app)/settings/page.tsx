import { desc } from "drizzle-orm";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Field, formatDate, KeyValue, Money, Note, PageHeader, Pill, Section } from "@/components/ui";
import { parseStudioConfig } from "@/domain/config";
import { getDb } from "@/db";
import { configVersions, reserveLedger } from "@/db/schema";
import { INDIAN_STATES } from "@/lib/states";
import { requireMember } from "@/lib/session";
import { hasVoted } from "@/server/approvals";
import { listMembers } from "@/server/auth";
import { reserveBalance } from "@/server/finance";
import { getStudio } from "@/server/settings";
import {
  addMemberAction,
  changePasswordAction,
  decideReserveAction,
  decideRulesAction,
  editRulesAction,
  newRulesDraftAction,
  submitRulesAction,
  updateMemberAction,
  updateStudioAction,
} from "./actions";

export const metadata = { title: "Studio and rules" };

const ROLES = ["Sales", "PM", "Design", "Content", "FE", "BE", "DevOps", "QA"];
const PCT = [
  ["reserve_pct", "Business reserve (% of profit)"],
  ["base_share_pct", "Base share, split equally (%)"],
  ["pool_pct", "Contribution pool, split by points (%)"],
  ["communication_cap_pct", "Communication cap (% of project points)"],
  ["sales_cap_pct", "Sales and origination cap (%)"],
  ["micro_task_cap_pct", "1-point task cap (% of a partner's points)"],
  ["origination_credit_pct", "Origination credit (% of planned points)"],
  ["calibration_flag_pct", "Calibration flag (% off estimate)"],
] as const;
const NUM = [
  ["adjustment_min", "Lowest adjustment factor"],
  ["adjustment_max", "Highest adjustment factor"],
  ["effort_adjustment_trigger_multiple", "Raise factor only above this × estimate"],
  ["own_defect_fix_points", "Points for fixing your own defect"],
  ["micro_task_points_threshold", "Counts as a 1-point task at or below"],
  ["auto_approve_hours", "Proposals approve themselves after (hours)"],
  ["dispute_window_days", "Disputes allowed within (days of verification)"],
  ["dispute_default_resolution_days", "Unresolved disputes default after (days)"],
  ["dispute_retro_threshold", "Disputes that trigger a retrospective"],
  ["msme_payment_days", "MSME payment limit (days)"],
] as const;

export default async function SettingsPage() {
  const me = await requireMember();
  const db = getDb();
  const studio = getStudio(db);
  const members = listMembers(db);
  const versions = db.select().from(configVersions).orderBy(desc(configVersions.version)).all();
  const active = versions.find((v) => v.status === "active");
  const draft = versions.find((v) => v.status === "draft");
  const pending = versions.find((v) => v.status === "pending");
  const cfg = parseStudioConfig((draft ?? active)!.data);
  const calc = cfg.calculation;
  const ledger = db.select().from(reserveLedger).orderBy(desc(reserveLedger.id)).limit(30).all();
  const name = (id: number | null) => members.find((m) => m.id === id)?.name ?? "system";
  return (
    <>
      <PageHeader title="Studio and rules" subtitle="Studio details, partners, the money rules, the reserve and backups." />

      <Section title="Rules" description="Every number in the split is here. Changes are made in a draft and become active only when every partner approves. Projects keep the rules they were planned with.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {versions.map((v) => (
            <Pill key={v.id} tone={v.status === "active" ? "verified" : v.status === "pending" ? "waiting" : v.status === "draft" ? "royal" : "neutral"}>
              v{v.version} {v.status}
            </Pill>
          ))}
        </div>
        {pending ? (
          <Note tone="waiting">
            Rules v{pending.version} ({pending.note}) wait for approval.{" "}
            {!hasVoted(db, "config_version", pending.id, pending.round, me.id) ? (
              <span className="ml-2 inline-flex gap-2 align-middle">
                <ActionButton action={decideRulesAction.bind(null, pending.id, "approve")} label="Approve" />
                <ActionButton action={decideRulesAction.bind(null, pending.id, "reject")} label="Send back" variant="danger" />
              </span>
            ) : (
              "You approved; waiting for your partner."
            )}
          </Note>
        ) : null}
        {draft ? (
          <ActionForm action={editRulesAction.bind(null, draft.id, cfg.communication_types.map((c) => c.code))} className="mt-3 space-y-4">
            <p className="font-semibold">Editing draft v{draft.version}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PCT.map(([k, label]) => (
                <Field key={k} label={label}>
                  <input className="field-input" name={k} inputMode="decimal" defaultValue={Math.round((calc[k] as number) * 10000) / 100} />
                </Field>
              ))}
              {NUM.map(([k, label]) => (
                <Field key={k} label={label}>
                  <input className="field-input" name={k} inputMode="decimal" defaultValue={calc[k] as number} />
                </Field>
              ))}
              <Field label="Unresolved disputes split">
                <select className="field-input" name="dispute_default_split_mode" defaultValue={calc.dispute_default_split_mode}>
                  <option value="share_between_parties">Points shared 50/50 between the partners</option>
                  <option value="halve_points">Disputed points halved</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name="distribute_tds_credit" defaultChecked={calc.distribute_tds_credit} /> Distribute TDS credit
              </label>
            </div>
            <fieldset>
              <legend className="mb-2 font-semibold">Points per communication (lead / required second attendee)</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {cfg.communication_types.map((c) => (
                  <label key={c.code} className="flex items-center justify-between gap-2 text-sm">
                    <span>{c.name}</span>
                    <span className="flex gap-1">
                      <input className="field-input w-14" name={`lead_${c.code}`} defaultValue={c.lead_points} inputMode="decimal" aria-label={`${c.name} lead points`} />
                      <input className="field-input w-14" name={`second_${c.code}`} defaultValue={c.second_attendee_points} inputMode="decimal" aria-label={`${c.name} second attendee points`} />
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2">
              <SubmitButton variant="secondary">Save draft</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <KeyValue
            items={[
              ["Reserve", `${calc.reserve_pct * 100}% of profit`],
              ["Split", `${calc.base_share_pct * 100}% equally, ${calc.pool_pct * 100}% by verified points`],
              ["Caps", `communication ${calc.communication_cap_pct * 100}%, sales ${calc.sales_cap_pct * 100}%, 1-point tasks ${calc.micro_task_cap_pct * 100}%`],
              ["Origination credit", `${calc.origination_credit_pct * 100}% of planned points`],
              ["Adjustment factor", `${calc.adjustment_min}–${calc.adjustment_max}`],
              ["Proposals", `approve themselves after ${calc.auto_approve_hours} hours`],
              ["Disputes", `within ${calc.dispute_window_days} days; default after ${calc.dispute_default_resolution_days} days`],
            ]}
          />
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {draft ? <ActionButton action={submitRulesAction.bind(null, draft.id)} label="Send draft for approval" /> : null}
          {!draft && !pending ? (
            <ActionForm action={newRulesDraftAction} className="flex flex-wrap gap-2">
              <input className="field-input w-72" name="note" placeholder="Why the rules change" aria-label="Reason" />
              <SubmitButton variant="secondary">Change the rules</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </Section>

      <Section title="Reserve" description="Money kept back from each project for tools, taxes, bad debts and slow months. Releases need the other partner's approval.">
        <p className="mb-2 text-lg">
          Balance <Money paise={reserveBalance(db)} className="font-bold" />
        </p>
        {ledger.length ? (
          <table className="ledger-table text-sm">
            <tbody>
              {ledger.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.entryDate)}</td>
                  <td>{r.purpose}</td>
                  <td className="num">
                    <Money paise={r.direction === "in" ? r.amount : -r.amount} />
                  </td>
                  <td>
                    {r.status === "pending" && r.createdBy !== me.id ? (
                      <span className="inline-flex gap-1">
                        <ActionButton action={decideReserveAction.bind(null, r.id, "approved")} label="Approve" />
                        <ActionButton action={decideReserveAction.bind(null, r.id, "rejected")} label="Reject" variant="danger" />
                      </span>
                    ) : (
                      <Pill tone={r.status === "approved" ? "verified" : r.status === "pending" ? "waiting" : "ledger"}>{r.status}</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-faint">Each closed project adds its reserve here.</p>
        )}
      </Section>

      <Section title="Partners">
        <ul className="divide-y divide-rule">
          {members.map((m) => (
            <li key={m.id} className="py-3">
              <details>
                <summary className="cursor-pointer">
                  <span className="font-semibold">{m.name}</span> <span className="text-sm text-ink-soft">{m.email}</span> {m.active ? null : <Pill tone="ledger">inactive</Pill>}{" "}
                  <span className="text-sm text-ink-faint">{m.roles.join(", ")}</span>
                </summary>
                <ActionForm action={updateMemberAction.bind(null, m.id)} className="mt-2 space-y-2">
                  <input className="field-input max-w-sm" name="name" defaultValue={m.name} aria-label="Name" />
                  <div className="flex flex-wrap gap-3">
                    {ROLES.map((r) => (
                      <label key={r} className="flex items-center gap-1 text-sm">
                        <input type="checkbox" name={`role_${r}`} defaultChecked={m.roles.includes(r)} /> {r}
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={m.active} /> Active
                  </label>
                  <SubmitButton variant="secondary" size="sm">
                    Save
                  </SubmitButton>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold text-royal">Add a member</summary>
          <ActionForm action={addMemberAction} className="mt-2 grid max-w-xl gap-2" resetOnSuccess>
            <input className="field-input" name="name" placeholder="Name" required aria-label="Name" />
            <input className="field-input" type="email" name="email" placeholder="Email" required aria-label="Email" />
            <input className="field-input" type="password" name="password" placeholder="Temporary password (10+ characters)" required minLength={10} aria-label="Temporary password" />
            <div className="flex flex-wrap gap-3">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name={`role_${r}`} /> {r}
                </label>
              ))}
            </div>
            <div>
              <SubmitButton variant="secondary">Add member</SubmitButton>
            </div>
          </ActionForm>
        </details>
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold text-royal">Change my password</summary>
          <ActionForm action={changePasswordAction} className="mt-2 grid max-w-sm gap-2" resetOnSuccess>
            <input className="field-input" type="password" name="current" placeholder="Current password" required autoComplete="current-password" aria-label="Current password" />
            <input className="field-input" type="password" name="next" placeholder="New password (10+ characters)" required minLength={10} autoComplete="new-password" aria-label="New password" />
            <div>
              <SubmitButton variant="secondary">Change password</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </Section>

      <Section title="Studio details" description="Used on invoices and statements.">
        <ActionForm action={updateStudioAction} className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <Field label="Studio name">
            <input className="field-input" name="name" defaultValue={studio?.name} required />
          </Field>
          <Field label="Legal name">
            <input className="field-input" name="legal_name" defaultValue={studio?.legalName} />
          </Field>
          <Field label="State">
            <select className="field-input" name="state_code" defaultValue={studio?.stateCode}>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="GSTIN">
            <input className="field-input" name="gstin" defaultValue={studio?.gstin} maxLength={15} />
          </Field>
          <Field label="Udyam number">
            <input className="field-input" name="udyam" defaultValue={studio?.udyamNumber} />
          </Field>
          <Field label="Invoice prefix" hint="Numbers look like INV/26-27/001 (16 characters at most)">
            <input className="field-input" name="invoice_prefix" defaultValue={studio?.invoicePrefix} maxLength={6} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <textarea className="field-input" name="address" rows={2} defaultValue={studio?.address} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="gst_registered" defaultChecked={studio?.gstRegistered} /> GST-registered (applies to new projects)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="msme_registered" defaultChecked={studio?.msmeRegistered} /> Udyam (MSME) registered
          </label>
          <div>
            <SubmitButton variant="secondary">Save studio details</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <Section title="Backups" description="Everything lives in one folder on your server (DATA_DIR): the database and uploaded files. Copy that folder somewhere safe regularly, or download here.">
        <div className="flex flex-wrap gap-3">
          <a href="/export/database" className="rounded-md border border-royal bg-royal px-4 py-2 font-semibold text-white hover:bg-royal-dark">
            Download database copy
          </a>
          <a href="/export/json" className="rounded-md border border-rule-strong px-4 py-2 font-semibold text-royal hover:border-royal">
            Download all data as JSON
          </a>
        </div>
        <p className="mt-2 text-sm text-ink-soft">Uploaded files are not inside these downloads; back up the files folder too (see README, “Backups”).</p>
      </Section>
    </>
  );
}
