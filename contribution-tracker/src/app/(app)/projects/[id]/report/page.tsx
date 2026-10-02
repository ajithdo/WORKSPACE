import { formatDate, Note, Section } from "@/components/ui";
import { isoDate } from "@/server/context";
import { ShareText } from "@/components/share-text";
import { getDb } from "@/db";
import { addDaysIso } from "@/domain/money";
import { whatsappNumber } from "@/domain/reminders";
import { requireMember } from "@/lib/session";
import { progressReport, progressText } from "@/server/progressReport";
import { projectHeader } from "@/server/queries";
import { getStudio } from "@/server/settings";
import { PrintButton } from "../statement/[snapshotId]/print-button";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export default async function ClientUpdatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const q = await searchParams;
  const db = getDb();
  const today = isoDate(new Date());
  const to = q.to && isoDatePattern.test(q.to) ? q.to : today;
  const from = q.from && isoDatePattern.test(q.from) && q.from <= to ? q.from : addDaysIso(to, -6);
  const r = progressReport(db, projectId, from, to);
  const { client } = projectHeader(db, projectId);
  const studio = getStudio(db);
  const studioName = studio?.legalName || studio?.name || "";
  const next = r.milestones.find((m) => !m.done);
  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
      <article className="print-area">
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
          <label className="text-sm font-semibold">
            From
            <input type="date" name="from" defaultValue={from} className="field-input mt-1 block" />
          </label>
          <label className="text-sm font-semibold">
            To
            <input type="date" name="to" defaultValue={to} className="field-input mt-1 block" />
          </label>
          <button type="submit" className="rounded-md border border-rule-strong px-4 py-2 font-semibold text-royal hover:border-royal">
            Show
          </button>
          <span className="ml-auto">
            <PrintButton />
          </span>
        </form>
        <header className="mb-4 border-b-2 border-ink pb-3">
          <p className="text-sm text-ink-soft">{studioName}</p>
          <h2 className="text-2xl font-bold">Progress update: {r.projectName}</h2>
          <p className="text-ink-soft">
            {r.clientName ? `For ${r.clientName}, ` : ""}
            {formatDate(from)} to {formatDate(to)}
          </p>
        </header>
        {r.milestones.length ? (
          <Section title="Milestones">
            <ol className="grid gap-1 text-sm sm:grid-cols-2">
              {r.milestones.map((m) => (
                <li key={m.code} className={m.done ? "" : m === next ? "font-semibold" : "text-ink-soft"}>
                  <span aria-hidden="true">{m.done ? "✓" : m === next ? "→" : "○"}</span> {m.name}
                  {m.done && m.at ? <span className="text-ink-faint"> ({formatDate(m.at)})</span> : null}
                  <span className="sr-only">{m.done ? " (done)" : m === next ? " (next)" : " (later)"}</span>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}
        <Section title="Completed in this period">
          {r.done.length ? (
            <ul className="list-disc pl-5 text-sm">
              {r.done.map((d) => (
                <li key={d.code}>
                  {d.name} <span className="text-ink-faint">({formatDate(d.at)})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Nothing was signed off in these dates.</p>
          )}
        </Section>
        <Section title="In progress">
          {r.inProgress.length ? (
            <ul className="list-disc pl-5 text-sm">
              {r.inProgress.map((t) => (
                <li key={t.code}>{t.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No work is in progress right now.</p>
          )}
        </Section>
        {r.waitingOnClient.length ? (
          <Section title="Waiting on you">
            <ul className="list-disc pl-5 text-sm">
              {r.waitingOnClient.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Section>
        ) : null}
      </article>
      <aside className="space-y-3">
        <Note>Only client-facing work is listed. Sales, partner admin and internal tasks stay private. After you send it, log it under Communications as a progress update.</Note>
        <ShareText
          label="Message for the client (edit before sending)"
          text={progressText(r, studioName)}
          subject={`Progress update: ${r.projectName}`}
          phone={whatsappNumber(client?.contactPhone ?? "")}
          email={client?.contactEmail ?? ""}
        />
      </aside>
    </div>
  );
}
