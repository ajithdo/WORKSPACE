import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { headers } from "next/headers";
import { Field, formatDateTime, Note, Pill, Section } from "@/components/ui";
import type { SiteCheck } from "@/domain/siteRules";
import { getDb } from "@/db";
import { taskInstances } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireMember } from "@/lib/session";
import { aiConfigured, reportsFor, type CompletionOutput, type ResearchOutput } from "@/server/assistant";
import { loadProject } from "@/server/common";
import { acceptAction, addLibraryAction, addNewTaskAction, completionCheckAction, researchAction, saveBriefAction, siteCheckAction } from "./actions";

export const metadata = { title: "AI assistant" };

/** Links in AI output come from web content; only plain web links are rendered. */
const isWebLink = (u: string) => /^https?:\/\/[^\s]+$/i.test(u);

export default async function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const p = loadProject(db, projectId);
  const open = p.closeStatus !== "closed_locked";
  const ai = aiConfigured();
  const webhookOn = !!process.env.GITHUB_WEBHOOK_SECRET;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "your-server"}`;
  const reports = reportsFor({ db }, projectId);
  const tasks = db.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const byCode = new Map(tasks.map((t) => [t.code, t]));
  const openCode = (c: string) => ["planned", "in_progress", "blocked"].includes(byCode.get(c)?.status ?? "");
  const defaultUrl = p.siteUrls.live || p.siteUrls.staging || "";
  const researchTasks = tasks.filter((t) => ["L", "M"].includes(t.categoryCode) && !["verified", "locked", "cancelled"].includes(t.status));

  const Accept = ({ code, url, type, description }: { code: string; url: string | null; type: string; description: string }) =>
    open && openCode(code) && url ? (
      <ActionForm action={acceptAction.bind(null, projectId)} className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="url" value={url} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="description" value={description.slice(0, 300)} />
        <label className="flex items-center gap-1">
          <input type="checkbox" name="confirm" required /> I opened the link and it proves this
        </label>
        <SubmitButton variant="secondary" size="sm">
          Add as evidence and submit
        </SubmitButton>
      </ActionForm>
    ) : null;

  return (
    <>
      <Note>
        The assistant suggests; you decide. Accepting a suggestion adds evidence and submits the task in your name, and your partner still verifies it before any points count. {ai ? "" : "Claude features are off until ANTHROPIC_API_KEY is set on the server; the site check below works without it."}
      </Note>
      {open ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Section title="Check the site" description="Free automated checks: HTTPS, redirects, security headers, SEO basics, alt text, sitemap, robots.txt.">
            <ActionForm action={siteCheckAction.bind(null, projectId)} className="space-y-2">
              <input className="field-input" name="url" defaultValue={defaultUrl} placeholder="https://staging.example.com" aria-label="Site address" />
              <SubmitButton variant="secondary">Run site check</SubmitButton>
            </ActionForm>
          </Section>
          <Section title="What did we finish?" description="After a build session, Claude reads the site, your notes and the last two weeks of commits, and lists tasks that look done.">
            <ActionForm action={completionCheckAction.bind(null, projectId)} className="space-y-2">
              <input className="field-input" name="url" defaultValue={defaultUrl} placeholder="https://staging.example.com" aria-label="Site address" />
              <Field label="Build notes" hint="Paste your AI coding tool's final summary, commit list or PR description. No secrets.">
                <textarea className="field-input" name="notes" rows={4} />
              </Field>
              <SubmitButton disabled={!ai}>Ask Claude</SubmitButton>
            </ActionForm>
          </Section>
          <Section title="Research the niche" description="Claude searches the web for the best sites of this kind and suggests what to add.">
            <ActionForm action={researchAction.bind(null, projectId)} className="space-y-2">
              <input className="field-input" name="niche" placeholder="Bakery with custom cakes" required aria-label="Kind of business" />
              <input className="field-input" name="location" placeholder="City (optional)" aria-label="City" />
              <input className="field-input" name="focus" placeholder="Focus, e.g. online orders (optional)" aria-label="Focus" />
              <SubmitButton disabled={!ai}>Research</SubmitButton>
            </ActionForm>
          </Section>
        </div>
      ) : null}

      {reports.map((r) => (
        <Section key={r.id} title={r.kind === "site_check" ? "Site check" : r.kind === "completion" ? "Completion check" : "Web research"} description={`${formatDateTime(r.createdAt)}${r.model ? `, ${r.model}` : ""}`}>
          {r.kind === "site_check" ? (
            <ul className="divide-y divide-rule text-sm">
              {(r.output as { checks: SiteCheck[]; finalUrl: string }).checks.map((c) => (
                <li key={c.id} className="py-2">
                  <span className={c.ok ? "font-semibold text-verified" : "font-semibold text-ledger"}>{c.ok ? "Pass" : "Fix"}</span> {c.label}: {c.detail}
                  {c.ok
                    ? c.taskCodes.filter(openCode).map((code) => (
                        <div key={code}>
                          Suggests <strong>{code}</strong> {byCode.get(code)?.name} is done.
                          <Accept code={code} url={(r.output as { finalUrl: string }).finalUrl} type="url_live" description={`Automated site check: ${c.label} — ${c.detail}`} />
                        </div>
                      ))
                    : null}
                </li>
              ))}
            </ul>
          ) : r.kind === "completion" ? (
            <>
              <p className="mb-2">{(r.output as CompletionOutput).summary}</p>
              <ul className="divide-y divide-rule text-sm">
                {(r.output as CompletionOutput).tasks.map((t) => (
                  <li key={t.code} className="py-2">
                    <Pill tone={t.verdict === "done" ? "verified" : t.verdict === "partly" ? "waiting" : "neutral"}>{t.verdict.replace("_", " ")}</Pill> <strong>{t.code}</strong> {byCode.get(t.code)?.name}{" "}
                    <span className="text-ink-faint">({t.confidence} confidence)</span>
                    <p className="text-ink-soft">{t.reason}</p>
                    {t.verdict === "done" ? <Accept code={t.code} url={t.evidenceUrl} type={t.evidenceType ?? "url_live"} description={`Claude review: ${t.reason}`} /> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ResearchView report={r.output as ResearchOutput & { brief: string; sources: { url: string; title: string }[] }} reportId={r.id} />
          )}
        </Section>
      ))}
      <Section title="Commits as evidence (GitHub)" description="Write the task code in your commit message, for example “AI-05: add sitemap”. Each push adds the commit as strong evidence on that task, in the name of the partner whose email matches the commit author. You still submit; your partner still verifies.">
        {webhookOn ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              In the GitHub repository: Settings → Webhooks → Add webhook.
            </li>
            <li>
              Payload URL: <code className="break-all rounded bg-page px-1">{`${origin}/api/webhooks/github/${p.code}`}</code>
            </li>
            <li>Content type: application/json. Secret: the GITHUB_WEBHOOK_SECRET from the server&apos;s .env. Events: just the push event.</li>
            <li>Use the same email for git commits as for signing in here (git config user.email).</li>
          </ol>
        ) : (
          <p className="text-sm text-ink-soft">Off. To turn it on, set GITHUB_WEBHOOK_SECRET in the server&apos;s .env (any long random text) and restart; the setup steps then appear here.</p>
        )}
      </Section>
    </>
  );

  function ResearchView({ report, reportId }: { report: ResearchOutput & { brief: string; sources: { url: string; title: string }[] }; reportId: number }) {
    return (
      <div className="space-y-3">
        <p>{report.summary}</p>
        <ul className="divide-y divide-rule text-sm">
          {report.suggestions.map((s, i) => (
            <li key={i} className="py-2">
              <Pill tone={s.priority === "must" ? "ledger" : s.priority === "should" ? "waiting" : "neutral"}>{s.priority}</Pill> <strong>{s.title}</strong>
              <p className="text-ink-soft">{s.why}</p>
              {s.exampleUrls.length ? (
                <p>
                  Examples:{" "}
                  {s.exampleUrls.filter(isWebLink).slice(0, 3).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="mr-2 font-semibold text-royal hover:underline">
                      {u.replace(/^https?:\/\//, "").slice(0, 40)}
                    </a>
                  ))}
                </p>
              ) : null}
              {open ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {s.libraryCodes.map((code) =>
                    byCode.has(code) ? (
                      <span key={code} className="text-ink-faint">
                        {code} already in plan
                      </span>
                    ) : (
                      <ActionButton key={code} action={addLibraryAction.bind(null, projectId, code)} label={`Add ${code} to plan`} variant="secondary" />
                    ),
                  )}
                  {s.newTask && !s.libraryCodes.length ? <ActionButton action={addNewTaskAction.bind(null, projectId, s.newTask)} label={`Add task: ${s.newTask.name}`} variant="secondary" /> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer font-semibold text-royal">Full brief and {report.sources.length} sources</summary>
          <div className="mt-2 whitespace-pre-wrap text-sm">{report.brief}</div>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {report.sources.filter((s) => isWebLink(s.url)).map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-royal hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
        {open && researchTasks.length ? (
          <ActionForm action={saveBriefAction.bind(null, reportId)} className="flex flex-wrap items-center gap-2 text-sm">
            <select className="field-input w-auto" name="task" aria-label="Research task">
              {researchTasks.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code} {t.name}
                </option>
              ))}
            </select>
            <SubmitButton variant="secondary" size="sm">
              Attach brief as evidence
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>
    );
  }
}
