import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { getDb } from "@/db";
import { INDIAN_STATES } from "@/lib/states";
import { isSetUp } from "@/server/auth";
import { setupAction } from "../auth-actions";

export const metadata = { title: "Set up your studio" };

const ROLES = ["Sales", "PM", "Design", "Content", "FE", "BE", "DevOps", "QA"] as const;
const ROLE_LABELS: Record<string, string> = { FE: "Frontend", BE: "Backend", PM: "Project management", QA: "Testing (QA)", DevOps: "DevOps / hosting" };

function PartnerFields({ n, defaults }: { n: 1 | 2; defaults: string[] }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-rule p-4">
      <legend className="px-1 font-bold">{n === 1 ? "You" : "Your partner"}</legend>
      <Field label="Name">
        <input className="field-input" name={`p${n}_name`} required autoComplete={n === 1 ? "name" : "off"} />
      </Field>
      <Field label="Email">
        <input className="field-input" type="email" name={`p${n}_email`} required autoComplete={n === 1 ? "email" : "off"} />
      </Field>
      <Field label={n === 1 ? "Password" : "Temporary password"} hint="At least 10 characters. Your partner can change theirs after signing in.">
        <input className="field-input" type="password" name={`p${n}_password`} minLength={10} required autoComplete="new-password" />
      </Field>
      <div>
        <span className="mb-1 block text-sm font-semibold">Usual roles</span>
        <span className="mb-2 block text-xs text-ink-faint">Used to suggest who owns each task in a new plan. You can change any owner later.</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ROLES.map((r) => (
            <label key={r} className="inline-flex items-center gap-1.5 text-sm">
              <input type="checkbox" name={`p${n}_role_${r}`} defaultChecked={defaults.includes(r)} /> {ROLE_LABELS[r] ?? r}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

export default function SetupPage() {
  if (isSetUp(getDb())) redirect("/login");
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="ledger-page rounded-lg border border-rule py-8 pr-6 shadow-sm">
        <h1 className="text-2xl font-bold">Set up your studio</h1>
        <p className="mt-1 max-w-prose text-ink-soft">
          This happens once. It creates both partners and loads the 343-task library and the default rules (20% base share, 80% contribution pool, 10% reserve).
          Every number can be changed later, with both partners agreeing.
        </p>
        <ActionForm action={setupAction} className="mt-6 space-y-6">
          <fieldset className="space-y-3">
            <legend className="mb-1 font-bold">Studio</legend>
            <Field label="Studio name">
              <input className="field-input" name="studio_name" required />
            </Field>
            <Field label="Legal name" hint="As on your partnership deed or registration (optional).">
              <input className="field-input" name="legal_name" />
            </Field>
            <Field label="State" hint="Decides CGST + SGST (same state) or IGST (other state) on invoices.">
              <select className="field-input" name="state_code" required defaultValue="">
                <option value="" disabled>
                  Choose your state
                </option>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="GSTIN" hint="Leave empty if not registered.">
              <input className="field-input" name="gstin" maxLength={15} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="gst_registered" /> We are GST-registered (invoices add 18% GST)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="msme_registered" /> We have Udyam (MSME) registration (45-day payment protection on invoices)
            </label>
          </fieldset>
          <PartnerFields n={1} defaults={["FE", "Design", "Content"]} />
          <PartnerFields n={2} defaults={["BE", "DevOps", "PM", "Sales", "QA"]} />
          <SubmitButton className="w-full">Create studio and sign in</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
