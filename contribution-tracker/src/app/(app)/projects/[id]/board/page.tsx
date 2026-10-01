import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { Empty, Points, TaskStatus } from "@/components/ui";
import { PHASE_LABELS, PHASES, type Phase } from "@/domain/types";
import { getDb } from "@/db";
import { evidence, taskContributions, taskInstances } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { memberNames } from "@/server/queries";

export const metadata = { title: "Board" };

const FILTERS = [
  { key: "active", label: "Open work" },
  { key: "mine", label: "Mine" },
  { key: "check", label: "Waiting for a check" },
  { key: "done", label: "Verified" },
  { key: "all", label: "Everything" },
] as const;

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const me = await requireMember();
  const projectId = Number((await params).id);
  const show = (await searchParams).show ?? "active";
  const db = getDb();
  const names = memberNames(db);
  const tasks = db.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const ids = tasks.map((t) => t.id);
  const shares = ids.length ? db.select().from(taskContributions).where(inArray(taskContributions.taskInstanceId, ids)).all() : [];
  const evidenceCount = new Map<number, number>();
  if (ids.length) {
    for (const e of db
      .select({ s: evidence.subjectId })
      .from(evidence)
      .where(and(eq(evidence.subjectType, "task"), inArray(evidence.subjectId, ids)))
      .all())
      evidenceCount.set(e.s, (evidenceCount.get(e.s) ?? 0) + 1);
  }
  const mine = new Set(shares.filter((s) => s.memberId === me.id).map((s) => s.taskInstanceId));
  const filtered = tasks.filter((t) => {
    switch (show) {
      case "mine":
        return mine.has(t.id) && !["verified", "locked", "cancelled"].includes(t.status);
      case "check":
        return t.status === "submitted";
      case "done":
        return t.status === "verified" || t.status === "locked";
      case "all":
        return true;
      default:
        return ["in_progress", "blocked", "submitted", "planned"].includes(t.status);
    }
  });
  const byPhase = PHASES.map((ph) => ({ phase: ph, rows: filtered.filter((t) => t.phase === ph).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)) })).filter((g) => g.rows.length);
  const counts = {
    planned: tasks.filter((t) => t.status === "planned").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    submitted: tasks.filter((t) => t.status === "submitted").length,
    verified: tasks.filter((t) => t.status === "verified" || t.status === "locked").length,
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter tasks" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`?show=${f.key}`}
              aria-current={show === f.key ? "true" : undefined}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${show === f.key ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft hover:border-ink"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-ink-soft">
          {counts.planned} planned, {counts.in_progress} in progress, {counts.submitted} awaiting check, {counts.verified} verified
        </p>
      </div>
      {byPhase.length === 0 ? (
        <Empty title="Nothing here">Try another filter, or add tasks on the Plan tab.</Empty>
      ) : (
        byPhase.map((g) => (
          <section key={g.phase} className="mb-6">
            <h2 className="mb-1 border-b border-rule pb-1 font-bold">{PHASE_LABELS[g.phase as Phase]}</h2>
            <div className="overflow-x-auto">
              <table className="ledger-table min-w-[40rem]">
                <tbody>
                  {g.rows.map((t) => {
                    const owners = shares.filter((s) => s.taskInstanceId === t.id);
                    return (
                      <tr key={t.id}>
                        <td className="w-20 font-semibold">{t.code}</td>
                        <td>
                          <Link href={`/projects/${projectId}/tasks/${t.id}`} className="font-semibold hover:text-royal hover:underline">
                            {t.name}
                          </Link>
                        </td>
                        <td className="w-40 text-sm text-ink-soft">{owners.map((o) => names.get(o.memberId)?.split(" ")[0]).join(" + ")}</td>
                        <td className="num w-20 text-sm">
                          <Points value={t.defaultPoints * t.quantity * t.adjustmentFactor} /> pts
                        </td>
                        <td className="num w-24 text-sm text-ink-soft">{evidenceCount.get(t.id) ? `${evidenceCount.get(t.id)} evidence` : ""}</td>
                        <td className="w-32">
                          <TaskStatus status={t.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  );
}
