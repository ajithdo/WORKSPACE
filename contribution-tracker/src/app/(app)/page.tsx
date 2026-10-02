import Link from "next/link";
import { Empty, formatDateTime, PageHeader, Pill } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { inboxFor, type InboxKind } from "@/server/inbox";

export const metadata = { title: "Needs your action" };

const KIND_LABEL: Record<InboxKind, { label: string; tone: "royal" | "waiting" | "ledger" | "verified" | "neutral" }> = {
  verify_task: { label: "Verify work", tone: "royal" },
  approve_proposal: { label: "New task", tone: "waiting" },
  approve_plan: { label: "Plan", tone: "royal" },
  approve_snapshot: { label: "Closing split", tone: "ledger" },
  approve_post_lock: { label: "Correction", tone: "ledger" },
  approve_adjustment: { label: "Adjustment", tone: "waiting" },
  respond_dispute: { label: "Dispute", tone: "ledger" },
  verify_communication: { label: "Meeting", tone: "royal" },
  verify_payment: { label: "Payment", tone: "verified" },
  approve_expense: { label: "Expense", tone: "waiting" },
  approve_reserve: { label: "Reserve", tone: "waiting" },
  overdue_invoice: { label: "Overdue", tone: "ledger" },
  approve_version: { label: "Rules", tone: "royal" },
  setup_studio: { label: "Setup", tone: "neutral" },
};

export default async function InboxPage() {
  const member = await requireMember();
  const items = inboxFor(getDb(), member.id, new Date());
  return (
    <>
      <PageHeader
        title={`Hello, ${member.name.split(" ")[0]}`}
        subtitle={items.length ? `${items.length} thing${items.length === 1 ? "" : "s"} wait on you. Your partner's work earns points only after you check it.` : "Nothing is waiting on you right now."}
      />
      {items.length === 0 ? (
        <Empty title="You're all caught up">
          Start a project from <Link className="font-semibold text-royal" href="/projects/new">New project</Link>, or open <Link className="font-semibold text-royal" href="/projects">Projects</Link> to log work.
        </Empty>
      ) : (
        <ul className="divide-y divide-rule">
          {items.map((i, n) => {
            const k = KIND_LABEL[i.kind];
            return (
              <li key={`${i.kind}-${i.href}-${n}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
                <div className="w-28 shrink-0">
                  <Pill tone={k.tone}>{k.label}</Pill>
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={i.href} className="font-semibold text-ink hover:text-royal hover:underline">
                    {i.title}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    {i.projectName}
                    {i.detail ? <> — {i.detail}</> : null}
                  </p>
                </div>
                <span className="text-sm text-ink-faint">{formatDateTime(i.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
