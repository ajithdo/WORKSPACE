import { and, desc, eq, like, or } from "drizzle-orm";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Field, formatDate, Note, PageHeader, Pill, Points, ScrollTable, Section } from "@/components/ui";
import { getDb } from "@/db";
import { categoryTemplates, libraryVersions, projects, taskTemplates } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { hasVoted } from "@/server/approvals";
import { categoryCalibration } from "@/server/contribution";
import { activeConfig } from "@/server/versions";
import { decideAction, editTemplateAction, newDraftAction, submitDraftAction } from "./actions";

export const metadata = { title: "Task library" };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; v?: string }> }) {
  const me = await requireMember();
  const sp = await searchParams;
  const db = getDb();
  const versions = db.select().from(libraryVersions).orderBy(desc(libraryVersions.version)).all();
  const editing = versions.find((v) => v.status === "draft" || v.status === "pending");
  const active = versions.find((v) => v.status === "active");
  const shown = versions.find((v) => String(v.id) === sp.v) ?? editing ?? active;
  const q = (sp.q ?? "").trim();
  const cats = shown ? db.select().from(categoryTemplates).where(eq(categoryTemplates.libraryVersionId, shown.id)).all() : [];
  const conds = [eq(taskTemplates.libraryVersionId, shown?.id ?? 0)];
  if (sp.cat) conds.push(eq(taskTemplates.categoryCode, sp.cat));
  if (q) conds.push(or(like(taskTemplates.name, `%${q}%`), like(taskTemplates.code, `%${q.toUpperCase()}%`), like(taskTemplates.description, `%${q}%`))!);
  const templates = db
    .select()
    .from(taskTemplates)
    .where(and(...conds))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const isDraft = shown?.status === "draft";
  const allProjects = db.select({ id: projects.id }).from(projects).all().map((p) => p.id);
  const calibration = categoryCalibration(db, allProjects);
  const flag = activeConfig(db).data.calculation.calibration_flag_pct;
  const catName = new Map(cats.map((c) => [c.code, c.name]));
  return (
    <>
      <PageHeader title="Task library" subtitle="343 tasks with default points. Projects copy the version they were planned with, so editing the library never changes running projects." />
      <Section title="Versions">
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <a href={`?v=${v.id}`} className="font-semibold hover:underline">
                Version {v.version}
              </a>
              <Pill tone={v.status === "active" ? "verified" : v.status === "pending" ? "waiting" : v.status === "draft" ? "royal" : "neutral"}>{v.status}</Pill>
              <span className="text-sm text-ink-soft">
                {v.note}, {formatDate(v.createdAt)}
              </span>
              {v.status === "draft" ? <ActionButton action={submitDraftAction.bind(null, v.id)} label="Send for approval" /> : null}
              {v.status === "pending" && !hasVoted(db, "library_version", v.id, v.round, me.id) ? (
                <>
                  <ActionButton action={decideAction.bind(null, v.id, "approve")} label="Approve" />
                  <ActionButton action={decideAction.bind(null, v.id, "reject")} label="Send back" variant="danger" />
                </>
              ) : null}
            </li>
          ))}
        </ul>
        {!editing ? (
          <ActionForm action={newDraftAction} className="mt-3 flex flex-wrap gap-2">
            <input className="field-input max-w-md flex-1" name="note" placeholder="Why: quarterly calibration, new stack…" aria-label="Reason for the new version" />
            <SubmitButton variant="secondary">Start editing a new version</SubmitButton>
          </ActionForm>
        ) : null}
      </Section>

      <Section title={`Tasks in version ${shown?.version ?? ""}`} description={isDraft ? "This is a draft: change points, names and effort. Both partners approve before it becomes active." : undefined}>
        <form className="mb-3 flex flex-wrap gap-2" role="search">
          <input type="hidden" name="v" value={shown?.id ?? ""} />
          <input className="field-input max-w-xs" name="q" defaultValue={q} placeholder="Search tasks" aria-label="Search tasks" />
          <select className="field-input max-w-xs" name="cat" defaultValue={sp.cat ?? ""} aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
          <button className="rounded-md border border-rule-strong px-3 font-semibold text-royal" type="submit">
            Filter
          </button>
        </form>
        <ScrollTable>
          <table className="ledger-table min-w-[44rem]">
            <thead>
              <tr>
                <th>Task</th>
                <th>Name</th>
                <th>Owner role</th>
                <th>Effort</th>
                <th className="num">Points</th>
                <th>Standard</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="font-semibold">{t.code}</td>
                  <td>
                    {isDraft ? (
                      <details>
                        <summary className="cursor-pointer">{t.name}</summary>
                        <ActionForm action={editTemplateAction.bind(null, t.id)} className="mt-2 grid gap-2 sm:grid-cols-4">
                          <div className="sm:col-span-2">
                            <Field label="Name">
                              <input className="field-input" name="name" defaultValue={t.name} />
                            </Field>
                          </div>
                          <Field label="Points">
                            <input className="field-input" name="points" defaultValue={t.defaultPoints} inputMode="numeric" />
                          </Field>
                          <Field label="Complexity">
                            <select className="field-input" name="complexity" defaultValue={t.complexity}>
                              {["Low", "Medium", "High", "Varies"].map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                          </Field>
                          <div className="sm:col-span-2">
                            <Field label="Effort">
                              <input className="field-input" name="effort" defaultValue={t.effortRange} />
                            </Field>
                          </div>
                          <div className="self-end">
                            <SubmitButton variant="secondary" size="sm">
                              Save
                            </SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                    ) : (
                      <span title={t.description}>{t.name}</span>
                    )}
                    <span className="block text-xs text-ink-faint">{catName.get(t.categoryCode)}</span>
                  </td>
                  <td className="text-sm">{t.defaultOwnerRole}</td>
                  <td className="text-sm">{t.effortRange}</td>
                  <td className="num font-semibold">{t.defaultPoints}</td>
                  <td className="text-sm">{t.inStandardProject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      </Section>

      <Section id="calibration" title="Calibration report" description={`Actual hours against the library's estimate, across all projects. Categories more than ${Math.round(flag * 100)}% off are flagged for the quarterly review (BO-02).`}>
        {calibration.some((c) => c.hours > 0) ? (
          <ScrollTable>
            <table className="ledger-table min-w-[40rem]">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Verified points</th>
                  <th className="num">Estimated hours</th>
                  <th className="num">Logged hours</th>
                  <th className="num">Hours per point</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {calibration
                  .filter((c) => c.hours > 0)
                  .map((c) => {
                    const ratio = c.estimatedHours > 0 ? c.hours / c.estimatedHours : null;
                    const off = ratio !== null && Math.abs(ratio - 1) > flag;
                    return (
                      <tr key={c.categoryCode}>
                        <td>
                          {c.categoryCode} {catName.get(c.categoryCode)}
                        </td>
                        <td className="num">
                          <Points value={c.verifiedPoints} />
                        </td>
                        <td className="num">{c.estimatedHours.toFixed(1)}</td>
                        <td className="num">{c.hours.toFixed(1)}</td>
                        <td className="num">{c.hoursPerPoint?.toFixed(2) ?? "—"}</td>
                        <td>{off ? <Pill tone="waiting">{ratio! > 1 ? `${Math.round((ratio! - 1) * 100)}% over` : `${Math.round((1 - ratio!) * 100)}% under`}</Pill> : null}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </ScrollTable>
        ) : (
          <Note>No time logged yet. Log time on tasks (for calibration only, never for pay) and this report shows where default points are off.</Note>
        )}
      </Section>
    </>
  );
}
