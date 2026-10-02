import Link from "next/link";
import { Empty, PageHeader, Points, Section } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { myWork, type MyTask } from "@/server/myWork";

export const metadata = { title: "My work" };

const READY_LIMIT = 15;

function TaskList({ items, limit }: { items: MyTask[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <>
      <ul className="divide-y divide-rule">
        {shown.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="font-semibold text-royal hover:underline">
              {t.code} {t.name}
            </Link>
            <span className="text-sm text-ink-soft">{t.projectName}</span>
            <span className="ml-auto text-sm tabular-nums text-ink-soft">
              <Points value={t.points} /> pts
            </span>
            {t.note ? <p className="w-full text-sm text-ink-soft">{t.note}</p> : null}
          </li>
        ))}
      </ul>
      {limit && items.length > limit ? <p className="mt-2 text-sm text-ink-soft">and {items.length - limit} more, in phase order. Open a project&apos;s Board to see them all.</p> : null}
    </>
  );
}

export default async function MyWorkPage() {
  const me = await requireMember();
  const w = myWork(getDb(), me.id);
  const nothing = !w.sentBack.length && !w.inProgress.length && !w.blocked.length && !w.ready.length && !w.waitingOnGate.length;
  return (
    <>
      <PageHeader title="My work" subtitle="Tasks you own or share in open projects, in the order to pick them up. Work you need to check for your partner is under Needs your action." />
      {nothing ? <Empty title="Nothing on your plate">Tasks appear here once a project plan gives you an owner share.</Empty> : null}
      {w.sentBack.length ? (
        <Section title="Sent back to you" description="Your partner asked for changes. Fix, add evidence, submit again.">
          <TaskList items={w.sentBack} />
        </Section>
      ) : null}
      {w.inProgress.length ? (
        <Section title="In progress">
          <TaskList items={w.inProgress} />
        </Section>
      ) : null}
      {w.blocked.length ? (
        <Section title="Blocked">
          <TaskList items={w.blocked} />
        </Section>
      ) : null}
      {w.ready.length ? (
        <Section title="Ready to start">
          <TaskList items={w.ready} limit={READY_LIMIT} />
        </Section>
      ) : null}
      {w.waitingOnGate.length ? (
        <Section title="Waiting on a gate" description="These can start once the milestone named is complete.">
          <TaskList items={w.waitingOnGate} limit={READY_LIMIT} />
        </Section>
      ) : null}
    </>
  );
}
