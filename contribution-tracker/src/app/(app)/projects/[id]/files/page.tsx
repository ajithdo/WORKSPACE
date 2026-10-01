import { desc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Field, formatDate, Section } from "@/components/ui";
import { getDb } from "@/db";
import { files } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { projectHeader } from "@/server/queries";
import { retentionAction, uploadFileAction } from "./actions";

export const metadata = { title: "Files" };

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { members, config } = projectHeader(db, projectId);
  const rows = db.select().from(files).where(eq(files.projectId, projectId)).orderBy(desc(files.id)).all();
  const name = (id: number) => members.find((m) => m.id === id)?.name ?? "";
  const retention = config.retention;
  return (
    <>
      <Section title="Upload" description={`Every file is stored with its SHA-256 hash, so later edits are detectable. Keep finance records for ${retention.finance_years} years and delivery evidence ${retention.delivery_years_after_closure} years after closure (check with your CA).`}>
        <ActionForm action={uploadFileAction.bind(null, projectId)} className="grid gap-3 sm:grid-cols-4" resetOnSuccess>
          <Field label="File">
            <input className="field-input" type="file" name="file" required />
          </Field>
          <Field label="Folder">
            <select className="field-input" name="category" defaultValue="01_contract">
              {config.file_categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shared with client?">
            <select className="field-input" name="visibility" defaultValue="internal">
              <option value="internal">Internal only</option>
              <option value="client_shared">Shared with client</option>
            </select>
          </Field>
          <Field label="Keep until" hint="Optional">
            <input className="field-input" type="date" name="retention_until" />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-3">
            <input type="checkbox" name="no_secrets" required className="mt-1" /> No passwords, API keys, .env files or unredacted customer data
          </label>
          <div>
            <SubmitButton>Upload</SubmitButton>
          </div>
        </ActionForm>
      </Section>
      {config.file_categories.map((c) => {
        const inCat = rows.filter((f) => f.category === c.code);
        return (
          <Section key={c.code} title={c.code.replace("_", " ")} description={c.contents}>
            {inCat.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {inCat.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <a href={`/files/${f.id}`} className="font-semibold text-royal hover:underline">
                      {f.name}
                    </a>
                    <span className="text-ink-soft">
                      {size(f.size)}, {name(f.uploadedBy)}, {formatDate(f.uploadedAt)}
                      {f.visibility === "client_shared" ? ", shared with client" : ""}
                    </span>
                    <span className="font-mono text-xs text-ink-faint">{f.sha256.slice(0, 12)}…</span>
                    <ActionForm action={retentionAction.bind(null, f.id)} className="ml-auto flex items-center gap-2" showSuccess={false}>
                      <input className="field-input w-36 py-0.5 text-sm" type="date" name="retention_until" defaultValue={f.retentionUntil ?? ""} aria-label="Keep until" />
                      <label className="flex items-center gap-1">
                        <input type="checkbox" name="archived" defaultChecked={f.archived} /> archived
                      </label>
                      <SubmitButton variant="quiet" size="sm">
                        Save
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        );
      })}
      {rows.length === 0 ? <Empty title="No files yet">Contracts, briefs, designs, QA reports and handover documents live here, one folder per stage.</Empty> : null}
    </>
  );
}
