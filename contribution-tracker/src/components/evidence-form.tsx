import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import type { ActionState } from "@/lib/actions";

const TYPE_LABELS: Record<string, string> = {
  git_commit: "Git commit",
  pull_request: "Pull request",
  deployment: "Deployment record",
  release_tag: "Release tag",
  client_approval: "Client approval",
  signed_document: "Signed document",
  email_sent: "Email sent",
  meeting_notes_sent: "Meeting notes sent to client",
  test_report: "Test report",
  scan_report: "Scan report (Lighthouse, axe, audit)",
  invoice: "Invoice",
  bank_reference: "Bank reference",
  dns_lookup: "DNS lookup",
  url_live: "Live URL",
  design_file_link: "Design file link",
  document_link: "Document link",
  spreadsheet: "Spreadsheet",
  meeting_record: "Meeting record",
  bug_ticket: "Bug ticket",
  crawl_report: "Crawl report",
  config_record: "Configuration record (no secrets)",
  screen_recording: "Screen recording",
  screenshot: "Screenshot",
  document_file: "Document file",
  receipt: "Receipt",
  other: "Other",
};

export function EvidenceForm({
  action,
  types,
  defaultType,
  fileCategory = "11_internal",
  hint,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  types: { code: string; strength: string }[];
  defaultType?: string;
  fileCategory?: string;
  hint?: string;
}) {
  return (
    <ActionForm action={action} className="space-y-3 rounded-md border border-rule p-4" resetOnSuccess>
      {hint ? <p className="text-sm text-ink-soft">{hint}</p> : null}
      <input type="hidden" name="file_category" value={fileCategory} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type of evidence">
          <select className="field-input" name="type" defaultValue={defaultType ?? types[0]?.code}>
            {(["strong", "medium", "weak"] as const).map((s) => (
              <optgroup key={s} label={`${s[0]?.toUpperCase()}${s.slice(1)}`}>
                {types
                  .filter((t) => t.strength === s)
                  .map((t) => (
                    <option key={t.code} value={t.code}>
                      {TYPE_LABELS[t.code] ?? t.code}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="When it happened" hint="Optional">
          <input className="field-input" type="date" name="captured_at" />
        </Field>
      </div>
      <Field label="Link" hint="Pull request, deploy URL, design file, document, email thread…">
        <input className="field-input" name="url" type="url" placeholder="https://" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reference" hint="Commit SHA, PR number, deploy ID, UTR…">
          <input className="field-input" name="external_ref" />
        </Field>
        <Field label="File" hint="PDF, image or export. Stored with its SHA-256 hash.">
          <input className="field-input" type="file" name="file" />
        </Field>
      </div>
      <Field label="What it shows" hint="10–300 characters, enough for your partner to check it in two minutes.">
        <textarea className="field-input" name="description" rows={2} minLength={10} maxLength={300} required />
      </Field>
      <div className="space-y-1 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="personal_data" className="mt-1" /> It shows customers&apos; personal data
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="redacted" className="mt-1" /> Personal data in it is redacted
        </label>
        <label className="flex items-start gap-2 font-semibold">
          <input type="checkbox" name="no_secrets" className="mt-1" required /> No passwords, API keys, .env files or unredacted customer data
        </label>
      </div>
      <SubmitButton variant="secondary">Add evidence</SubmitButton>
    </ActionForm>
  );
}

export function evidenceTypeLabel(code: string): string {
  return TYPE_LABELS[code] ?? code;
}
