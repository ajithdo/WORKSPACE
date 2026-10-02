import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Note, Section } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { loadProject } from "@/server/common";
import { siteUrlsAction } from "../assistant/actions";
import { SiteViewer } from "./viewer";

export const metadata = { title: "Preview" };

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const p = loadProject(getDb(), projectId);
  const urls = (["local", "staging", "live"] as const).filter((k) => p.siteUrls[k]).map((k) => ({ label: k[0]!.toUpperCase() + k.slice(1), url: p.siteUrls[k]! }));
  return (
    <>
      {urls.length ? <SiteViewer urls={urls} /> : <Note>Add the site&apos;s addresses below to preview it here at phone, tablet and desktop sizes.</Note>}
      {p.closeStatus !== "closed_locked" ? (
        <Section title="Site addresses">
          <ActionForm action={siteUrlsAction.bind(null, projectId)} className="grid gap-3 sm:grid-cols-3">
            <Field label="On your computer" hint="e.g. http://localhost:3000 while you build">
              <input className="field-input" name="local" defaultValue={p.siteUrls.local ?? ""} />
            </Field>
            <Field label="Staging" hint="Password-protected staging is fine">
              <input className="field-input" name="staging" defaultValue={p.siteUrls.staging ?? ""} />
            </Field>
            <Field label="Live">
              <input className="field-input" name="live" defaultValue={p.siteUrls.live ?? ""} />
            </Field>
            <div>
              <SubmitButton variant="secondary">Save addresses</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : null}
    </>
  );
}
