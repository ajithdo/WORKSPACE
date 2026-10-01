import Link from "next/link";
import { and, desc, eq, like, lt } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/forms";
import { formatDateTime, PageHeader, ScrollTable } from "@/components/ui";
import { getDb } from "@/db";
import { auditLog, projects } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { verifyChainAction } from "./actions";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ project?: string; q?: string; before?: string }> }) {
  await requireMember();
  const sp = await searchParams;
  const db = getDb();
  const conds = [];
  if (sp.project) conds.push(eq(auditLog.projectId, Number(sp.project)));
  if (sp.q) conds.push(like(auditLog.action, `%${sp.q}%`));
  if (sp.before) conds.push(lt(auditLog.id, Number(sp.before)));
  const rows = db
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(100)
    .all();
  const projectNames = new Map(
    db
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .all()
      .map((p) => [p.id, p.code]),
  );
  const last = rows.at(-1);
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change, append-only. Each entry carries the hash of the one before it, so editing or deleting anything breaks the chain."
        actions={
          <ActionForm action={verifyChainAction}>
            <SubmitButton variant="secondary">Check integrity</SubmitButton>
          </ActionForm>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <select className="field-input max-w-xs" name="project" defaultValue={sp.project ?? ""} aria-label="Project">
          <option value="">All projects</option>
          {[...projectNames.entries()].map(([id, code]) => (
            <option key={id} value={id}>
              {code}
            </option>
          ))}
        </select>
        <input className="field-input max-w-xs" name="q" defaultValue={sp.q ?? ""} placeholder="Action, e.g. verify" aria-label="Action" />
        <button type="submit" className="rounded-md border border-rule-strong px-3 font-semibold text-royal">
          Filter
        </button>
      </form>
      <ScrollTable>
        <table className="ledger-table min-w-[48rem] text-sm">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th className="w-40">When</th>
              <th>Who</th>
              <th>What</th>
              <th>Project</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="text-ink-faint">{r.id}</td>
                <td>{formatDateTime(r.at)}</td>
                <td className="font-semibold">{r.actorLabel}</td>
                <td>
                  <details>
                    <summary className="cursor-pointer">
                      {r.action.replace(".", " ").replaceAll("_", " ")} {r.entityType.replaceAll("_", " ")} #{r.entityId}
                    </summary>
                    {r.before ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-page p-2 text-xs">before {r.before}</pre> : null}
                    {r.after ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-page p-2 text-xs">after {r.after}</pre> : null}
                  </details>
                </td>
                <td>{r.projectId ? <Link href={`/projects/${r.projectId}`}>{projectNames.get(r.projectId)}</Link> : "—"}</td>
                <td className="font-mono text-xs text-ink-faint">{r.hash.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      {rows.length === 100 && last ? (
        <p className="mt-3">
          <Link className="font-semibold text-royal hover:underline" href={`?${new URLSearchParams({ ...(sp.project ? { project: sp.project } : {}), ...(sp.q ? { q: sp.q } : {}), before: String(last.id) })}`}>
            Older entries
          </Link>
        </p>
      ) : null}
    </>
  );
}
