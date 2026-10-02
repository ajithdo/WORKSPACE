import Link from "next/link";
import { KeyValue, Money, Note, PageHeader, ScrollTable, Section } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { summaryYears, yearSummary } from "@/server/yearSummary";

export const metadata = { title: "Year at a glance" };

const fyLabel = (fy: string) => `FY 20${fy.replace("-", "–")}`;

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  await requireMember();
  const db = getDb();
  const years = summaryYears(db, new Date().toISOString().slice(0, 10));
  const asked = (await searchParams).fy;
  const fy = asked && years.includes(asked) ? asked : years[0]!;
  const y = yearSummary(db, fy);
  const s = y.studio;
  const anyPayout = y.partners.some((p) => p.total !== 0);
  return (
    <>
      <PageHeader
        title="Year at a glance"
        subtitle="Every project in one financial year (April to March): what each partner was paid from locked snapshots, and what the studio billed and received."
        actions={
          <nav aria-label="Financial year" className="flex flex-wrap gap-2">
            {years.map((v) => (
              <Link
                key={v}
                href={`/summary?fy=${v}`}
                aria-current={v === fy ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${v === fy ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft hover:border-royal"}`}
              >
                {fyLabel(v)}
              </Link>
            ))}
          </nav>
        }
      />
      <Section title="Partners" description="From contribution snapshots locked in this year. Reimbursements repay expenses and are not income.">
        {anyPayout ? (
          <ScrollTable>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th className="num">Projects</th>
                  <th className="num">Reimbursed</th>
                  <th className="num">Base share</th>
                  <th className="num">Contribution pool</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                  <th className="num">Still to pay</th>
                </tr>
              </thead>
              <tbody>
                {y.partners.map((p) => (
                  <tr key={p.memberId}>
                    <td className="font-semibold">{p.name}</td>
                    <td className="num">{p.projects}</td>
                    <td className="num">
                      <Money paise={p.reimbursement} />
                    </td>
                    <td className="num">
                      <Money paise={p.baseShare} />
                    </td>
                    <td className="num">
                      <Money paise={p.poolShare} />
                    </td>
                    <td className="num font-bold">
                      <Money paise={p.total} />
                    </td>
                    <td className="num">
                      <Money paise={p.paid} />
                    </td>
                    <td className="num">{p.due ? <Money paise={p.due} className="text-ledger" /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        ) : (
          <Note>No contribution snapshot was locked in {fyLabel(fy)} yet. Payouts appear here when a project closes.</Note>
        )}
      </Section>
      <Section title="Studio money" description={`${fyLabel(fy)}. For your CA, download the invoice and payment spreadsheets under Studio and rules.`}>
        <KeyValue
          items={[
            ["Invoiced, before GST", <Money key="a" paise={s.invoicedExGst} />],
            ["GST on those invoices", <Money key="b" paise={s.gstInvoiced} />],
            ["Cash received", <Money key="c" paise={s.cashReceived} />],
            ["Revenue counted (checked by a partner, before GST)", <Money key="d" paise={s.revenueExGst} />],
            ["TDS deducted by clients", <span key="e"><Money paise={s.tdsDeducted} />{s.tdsCertificatesPending ? ` (${s.tdsCertificatesPending} certificate${s.tdsCertificatesPending === 1 ? "" : "s"} pending)` : ""}</span>],
            ["Approved expenses", <Money key="f" paise={s.expenses} />],
            ["Added to the reserve", <Money key="g" paise={s.reserveIn} />],
            ["Released from the reserve", <Money key="h" paise={s.reserveOut} />],
            ["Projects closed (all time)", s.projectsClosedAllTime],
          ]}
        />
      </Section>
    </>
  );
}
