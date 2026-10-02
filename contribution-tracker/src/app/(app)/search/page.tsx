import Link from "next/link";
import { Empty, PageHeader, Pill } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { search } from "@/server/search";

export const metadata = { title: "Search" };

const KIND: Record<string, string> = { project: "Project", client: "Client", invoice: "Invoice", payment: "Payment", task: "Task" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireMember();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const hits = search(getDb(), me.id, q);
  return (
    <>
      <PageHeader title="Search" subtitle="Projects, clients (name, GSTIN, contact), invoice numbers, payment references (UTR) and tasks." />
      <form method="get" action="/search" className="mb-6 flex max-w-xl gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input id="q" name="q" type="search" defaultValue={q} autoFocus placeholder="e.g. INV/26-27/004, UTR, GSTIN, client or task" className="field-input flex-1" />
        <button type="submit" className="rounded-md border border-royal bg-royal px-4 py-2 font-semibold text-white hover:bg-royal-dark">
          Search
        </button>
      </form>
      {q.trim().length >= 2 && !hits.length ? <Empty title="Nothing found">Try part of a name, an invoice number or a bank reference.</Empty> : null}
      <ul className="divide-y divide-rule">
        {hits.map((h) => (
          <li key={`${h.kind}-${h.href}-${h.title}`} className="flex flex-wrap items-center gap-2 py-3">
            <Pill>{KIND[h.kind]}</Pill>
            <Link href={h.href} className="font-semibold text-royal hover:underline">
              {h.title}
            </Link>
            <span className="text-sm text-ink-soft">{h.detail}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
