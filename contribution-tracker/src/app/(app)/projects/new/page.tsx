import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { clients } from "@/db/schema";
import { INDIAN_STATES } from "@/lib/states";
import { requireMember } from "@/lib/session";
import { listMembers } from "@/server/auth";
import { getStudio } from "@/server/settings";
import { createProjectAction } from "../actions";

export const metadata = { title: "New project" };

const TYPES = [
  { value: "brochure", label: "Brochure site", hint: "225 standard tasks, about 349 points" },
  { value: "cms", label: "CMS site", hint: "Brochure plus content management" },
  { value: "ecommerce", label: "E-commerce", hint: "CMS plus shop, payments and refund policy" },
  { value: "booking", label: "Booking site", hint: "Brochure plus a booking system" },
  { value: "custom", label: "Custom", hint: "Start empty and add tasks yourself" },
  { value: "maintenance", label: "Maintenance (AMC)", hint: "Monthly updates, backups, support" },
  { value: "studio", label: "Studio work", hint: "Lead generation, calibration, governance — paid from the reserve" },
];

export default async function NewProjectPage() {
  const me = await requireMember();
  const db = getDb();
  const people = listMembers(db).filter((m) => m.active);
  const existingClients = db.select().from(clients).all();
  const studio = getStudio(db);
  return (
    <>
      <PageHeader title="New project" subtitle="The plan is pre-filled from the task library. You can add, remove and reassign tasks until both partners lock it." />
      <ActionForm action={createProjectAction} className="max-w-2xl space-y-6">
        <Field label="Project name">
          <input className="field-input" name="name" required placeholder="Sunrise Bakery website" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">What are you building?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TYPES.map((t, i) => (
              <label key={t.value} className="flex cursor-pointer gap-2 rounded-md border border-rule p-3 has-[:checked]:border-royal has-[:checked]:bg-royal-wash">
                <input type="radio" name="project_type" value={t.value} defaultChecked={i === 0} className="mt-1" />
                <span>
                  <span className="block font-semibold">{t.label}</span>
                  <span className="block text-xs text-ink-soft">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="multilingual" /> Add multilingual tasks (localisation)
          </label>
        </fieldset>
        <fieldset className="space-y-3 rounded-md border border-rule p-4">
          <legend className="px-1 text-sm font-semibold">Client (not needed for studio work)</legend>
          {existingClients.length ? (
            <Field label="Existing client">
              <select className="field-input" name="client_id" defaultValue="new">
                <option value="new">Add a new client below</option>
                {existingClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.businessName}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name">
              <input className="field-input" name="client_name" />
            </Field>
            <Field label="State" hint="Place of supply for GST">
              <select className="field-input" name="client_state" defaultValue={studio?.stateCode ?? ""}>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Contact person">
              <input className="field-input" name="client_contact" />
            </Field>
            <Field label="Client GSTIN" hint="Optional">
              <input className="field-input" name="client_gstin" maxLength={15} />
            </Field>
            <Field label="Contact email">
              <input className="field-input" type="email" name="client_email" />
            </Field>
            <Field label="Contact phone">
              <input className="field-input" name="client_phone" />
            </Field>
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quoted amount before GST (₹)" hint="Used for invoice suggestions">
            <input className="field-input" name="quoted" inputMode="decimal" placeholder="60,000" />
          </Field>
          <Field label="Who brought in this client?" hint="Gets the origination credit (5% of planned points)">
            <select className="field-input" name="originated_by" defaultValue={String(me.id)}>
              <option value="">Nobody (referral, inbound)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date">
            <input className="field-input" type="date" name="start_date" />
          </Field>
          <Field label="Target launch">
            <input className="field-input" type="date" name="target_launch_date" />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Contract</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="deemed_clause" /> The contract has a deemed-acceptance clause
          </label>
          <Field label="Days of client silence before deemed approval" hint="Only used when the clause is ticked">
            <input className="field-input w-32" name="deemed_days" inputMode="numeric" placeholder="5" />
          </Field>
        </fieldset>
        <SubmitButton>Create project and open the plan</SubmitButton>
      </ActionForm>
    </>
  );
}
