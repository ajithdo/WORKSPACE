import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Empty, Field, formatDate, KeyValue, Money, Note, Pill, Section, Stamp } from "@/components/ui";
import { formatINR } from "@/domain/money";
import { getDb } from "@/db";
import { expenses, invoices, payments, reserveLedger } from "@/db/schema";
import { requireMember } from "@/lib/session";
import { financeSummary, isSettled, overdueOn, reserveBalance } from "@/server/finance";
import { projectHeader } from "@/server/queries";
import { reminderMessage, whatsappNumber } from "@/domain/reminders";
import { ReminderPanel } from "./reminder";
import { getStudio } from "@/server/settings";
import {
  addExpenseAction,
  approveExpenseAction,
  cancelInvoiceAction,
  createInvoiceAction,
  issueInvoiceAction,
  recordPaymentAction,
  rejectExpenseAction,
  reserveReleaseAction,
  tdsCertificateAction,
  verifyPaymentAction,
  writeOffAction,
} from "./actions";

export const metadata = { title: "Finance" };

export default async function FinancePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, client, members, config } = projectHeader(db, projectId);
  const studio = getStudio(db);
  const open = p.closeStatus !== "closed_locked";
  const today = new Date().toISOString().slice(0, 10);
  const fin = financeSummary(db, projectId, today);
  const invs = db.select().from(invoices).where(eq(invoices.projectId, projectId)).orderBy(desc(invoices.id)).all();
  const pays = db.select().from(payments).where(eq(payments.projectId, projectId)).all();
  const exps = db.select().from(expenses).where(eq(expenses.projectId, projectId)).orderBy(desc(expenses.id)).all();
  const name = (id: number | null) => members.find((m) => m.id === id)?.name ?? "Studio account";
  const suggested = p.paymentSchedule.map((s) => ({ ...s, amount: Math.round((p.quotedAmountExGst * s.pct) / 100) }));
  const tdsOptions = Object.entries(config.tds_rates).map(([k, v]) => ({ label: `${k} (${v * 100}%)`, bp: Math.round(v * 10000) }));

  if (p.kind === "studio") {
    const releases = db.select().from(reserveLedger).where(eq(reserveLedger.projectId, projectId)).all();
    return (
      <>
        <Note>Studio work is paid from the reserve. Ask for a release; when your partner approves it, the money is split by this project&apos;s verified points (no reserve is taken from it again).</Note>
        <Section title="Reserve releases">
          <p className="mb-3 text-sm text-ink-soft">
            Reserve balance: <Money paise={reserveBalance(db)} />
          </p>
          <ul className="mb-4 text-sm">
            {releases.map((r) => (
              <li key={r.id}>
                {formatDate(r.entryDate)} <Money paise={r.amount} /> — {r.purpose} <Pill tone={r.status === "approved" ? "verified" : r.status === "pending" ? "waiting" : "ledger"}>{r.status}</Pill>
              </li>
            ))}
          </ul>
          {open ? (
            <ActionForm action={reserveReleaseAction.bind(null, projectId)} className="flex flex-wrap items-end gap-2" resetOnSuccess>
              <Field label="Amount (₹)">
                <input className="field-input w-40" name="amount" inputMode="decimal" required />
              </Field>
              <Field label="Purpose">
                <input className="field-input w-72" name="purpose" placeholder="Q3 business development and calibration" required />
              </Field>
              <SubmitButton>Request release</SubmitButton>
            </ActionForm>
          ) : null}
        </Section>
      </>
    );
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Note>
          Money is split on cash actually received. GST is not your income, so it is removed from every payment; TDS the client deducted is tracked as a tax credit for your CA and is not distributed.
          A payment counts only after the other partner checks it against the bank statement.
        </Note>
        <KeyValue
          items={[
            ["Quoted before GST", <Money key="q" paise={p.quotedAmountExGst} />],
            ["Invoiced with GST", <Money key="i" paise={fin.invoicedTotal} />],
            ["Cash received", <Money key="c" paise={fin.cashReceived} />],
            ["Revenue counted", <Money key="r" paise={fin.revenueExGstVerified} />],
            ["Waiting for a check", <Money key="w" paise={fin.revenueAwaitingVerification} />],
            ["TDS receivable", <Money key="t" paise={fin.tdsReceivable} />],
            ["Outstanding", <Money key="o" paise={fin.outstanding} />],
          ]}
        />
      </div>

      <Section title="Invoices" description={studio?.msmeRegistered && p.msmeApplicable ? "Udyam-registered: payment is due within 45 days of acceptance at the latest (MSMED Act)." : undefined}>
        {invs.length === 0 ? <Empty title="No invoices yet">Raise the advance invoice once the contract is signed (task I-01).</Empty> : null}
        <ul className="divide-y divide-rule">
          {invs.map((inv) => {
            const ps = pays.filter((x) => x.invoiceId === inv.id);
            const settled = fin.settledByInvoice.get(inv.id) ?? 0;
            const overdue = overdueOn(inv, today);
            return (
              <li key={inv.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/projects/${projectId}/invoice/${inv.id}`} className="font-bold text-royal hover:underline">
                    {inv.number ?? "Draft"}
                  </Link>
                  <Pill>{inv.type.replace("_", " ")}</Pill>
                  {inv.status === "paid" ? <Stamp tone="verified">Paid</Stamp> : <Pill tone={inv.status === "cancelled" ? "neutral" : inv.status === "draft" ? "neutral" : "waiting"}>{inv.status.replace("_", " ")}</Pill>}
                  {overdue ? <Pill tone="ledger">Overdue</Pill> : null}
                  {inv.writtenOffReason ? <Pill tone="ledger">Written off</Pill> : null}
                  <span className="ml-auto text-lg font-bold tabular-nums">
                    <Money paise={inv.total} />
                  </span>
                </div>
                <p className="text-sm text-ink-soft">
                  Issued {formatDate(inv.issueDate)}, due {formatDate(inv.dueDate)}
                  {inv.msmeDueDate ? `, MSME due ${formatDate(inv.msmeDueDate)}` : ""}. {formatINR(inv.amountExGst)} + {inv.igst ? `IGST ${formatINR(inv.igst)}` : `CGST ${formatINR(inv.cgst)} + SGST ${formatINR(inv.sgst)}`}
                  {inv.tdsExpectedRateBp ? `. Expect ${inv.tdsExpectedRateBp / 100}% TDS` : ""}. Settled {formatINR(settled)}.
                </p>
                {overdue && inv.number && open
                  ? (() => {
                      const m = reminderMessage({
                        studioName: studio?.legalName || studio?.name || "",
                        clientName: client?.businessName ?? "",
                        contactName: client?.contactName ?? "",
                        invoiceNumber: inv.number,
                        issueDate: inv.issueDate,
                        dueDate: inv.msmeDueDate ?? inv.dueDate,
                        outstandingPaise: Math.max(0, inv.total - settled),
                        today,
                        msme: !!studio?.msmeRegistered && p.msmeApplicable,
                        udyamNumber: studio?.udyamNumber ?? "",
                      });
                      return <ReminderPanel {...m} email={client?.contactEmail ?? ""} whatsapp={whatsappNumber(client?.contactPhone ?? "")} />;
                    })()
                  : null}
                {ps.length ? (
                  <table className="ledger-table mt-2 text-sm">
                    <thead>
                      <tr>
                        <th>Received</th>
                        <th>Reference</th>
                        <th className="num">Cash</th>
                        <th className="num">TDS</th>
                        <th className="num">Revenue (ex GST)</th>
                        <th>Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ps.map((x) => (
                        <tr key={x.id}>
                          <td>{formatDate(x.receivedDate)}</td>
                          <td>
                            {x.mode.toUpperCase()} {x.bankReference}
                          </td>
                          <td className="num">
                            <Money paise={x.amountReceived} />
                          </td>
                          <td className="num">
                            <Money paise={x.tdsDeducted} />
                            {x.tdsDeducted > 0 ? <span className="block text-xs text-ink-faint">certificate {x.tdsCertificateStatus}</span> : null}
                          </td>
                          <td className="num">
                            <Money paise={x.revenueExGst} />
                          </td>
                          <td>
                            {x.verifiedBy ? (
                              <Stamp tone="verified">Checked</Stamp>
                            ) : x.recordedBy !== me.id && open ? (
                              <ActionButton action={verifyPaymentAction.bind(null, x.id)} label="Matches bank" />
                            ) : (
                              <span className="text-ink-faint">Waiting for partner</span>
                            )}
                            {open && x.tdsDeducted > 0 && x.tdsCertificateStatus === "pending" ? (
                              <ActionForm action={tdsCertificateAction.bind(null, x.id, projectId)} className="mt-1 flex items-center gap-1">
                                <input type="file" name="file" className="w-36 text-xs" aria-label="TDS certificate (Form 16A)" />
                                <SubmitButton variant="quiet" size="sm">
                                  Certificate received
                                </SubmitButton>
                              </ActionForm>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {open ? (
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    {inv.status === "draft" ? <ActionButton action={issueInvoiceAction.bind(null, inv.id)} label="Issue (assign number)" /> : null}
                    {["sent", "part_paid"].includes(inv.status) && !inv.writtenOffReason ? (
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold text-royal">Record a payment</summary>
                        <ActionForm action={recordPaymentAction.bind(null, inv.id)} className="mt-2 grid gap-2 sm:grid-cols-3">
                          <Field label="Received on">
                            <input className="field-input" type="date" name="received_date" defaultValue={today} required />
                          </Field>
                          <Field label="Amount credited (₹)">
                            <input className="field-input" name="amount" inputMode="decimal" required />
                          </Field>
                          <Field label="TDS deducted (₹)">
                            <input className="field-input" name="tds" inputMode="decimal" defaultValue="0" />
                          </Field>
                          <Field label="Mode">
                            <select className="field-input" name="mode" defaultValue="bank">
                              {config.payment_modes.map((m) => (
                                <option key={m} value={m}>
                                  {m.toUpperCase()}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Bank reference (UTR / UPI / cheque)">
                            <input className="field-input" name="reference" required />
                          </Field>
                          <div className="self-end">
                            <SubmitButton variant="secondary">Record payment</SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                    ) : null}
                    {["draft", "sent"].includes(inv.status) && settled === 0 ? (
                      <ActionButton action={cancelInvoiceAction.bind(null, inv.id)} label="Cancel" variant="quiet" confirm="Cancel this invoice? Issued numbers stay in the series as cancelled." />
                    ) : null}
                    {["sent", "part_paid"].includes(inv.status) && !inv.writtenOffReason && !isSettled(inv) ? (
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold text-ledger">Write off the balance</summary>
                        <ActionForm action={writeOffAction.bind(null, inv.id)} className="mt-2 flex flex-wrap gap-2">
                          <input className="field-input max-w-sm flex-1" name="reason" required placeholder="Why it cannot be collected" aria-label="Reason" />
                          <SubmitButton variant="danger" size="sm" confirm="Write off the unpaid balance?">
                            Write off
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {open ? (
          <details className="mt-4 rounded-md border border-rule p-4" open={invs.length === 0}>
            <summary className="cursor-pointer font-semibold">New invoice</summary>
            {suggested.length && p.quotedAmountExGst ? (
              <p className="mt-2 text-sm text-ink-soft">
                Payment schedule: {suggested.map((s) => `${s.pct}% at ${s.milestoneCode} (${formatINR(s.amount)})`).join(", ")}
              </p>
            ) : null}
            <ActionForm action={createInvoiceAction.bind(null, projectId)} className="mt-3 grid gap-3 sm:grid-cols-3" resetOnSuccess>
              <Field label="Type">
                <select className="field-input" name="type" defaultValue={invs.length ? "final" : "advance"}>
                  {config.invoice_types.map((t) => (
                    <option key={t} value={t}>
                      {t.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount before GST (₹)">
                <input className="field-input" name="amount" inputMode="decimal" defaultValue={suggested[invs.length]?.amount ? String(suggested[invs.length]!.amount / 100) : ""} required />
              </Field>
              <Field label="TDS the client will deduct">
                <select className="field-input" name="tds" defaultValue={tdsOptions.find((o) => o.bp === 1000)?.bp ?? 0}>
                  {tdsOptions.map((o) => (
                    <option key={o.bp} value={o.bp}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Invoice date">
                <input className="field-input" type="date" name="issue_date" defaultValue={today} required />
              </Field>
              <Field label="Due date">
                <input className="field-input" type="date" name="due_date" required />
              </Field>
              <Field label="Accepted by client on" hint="For the MSME 45-day limit; defaults to the invoice date">
                <input className="field-input" type="date" name="acceptance_date" />
              </Field>
              <Field label="Milestone">
                <select className="field-input" name="milestone" defaultValue="">
                  <option value="">None</option>
                  {config.milestones.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.code} {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <input className="field-input" name="notes" />
                </Field>
              </div>
              <div>
                <SubmitButton>Create draft</SubmitButton>
              </div>
            </ActionForm>
          </details>
        ) : null}
      </Section>

      <Section title="Expenses" description="Reimbursed first to whoever paid, from revenue, before any profit is split. Never converted to points.">
        {exps.length ? (
          <table className="ledger-table text-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor and purpose</th>
                <th>Paid by</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {exps.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.expenseDate)}</td>
                  <td>
                    <strong>{e.vendor}</strong> {e.description}
                    {e.receiptFileId ? (
                      <a className="ml-2 font-semibold text-royal hover:underline" href={`/files/${e.receiptFileId}`}>
                        receipt
                      </a>
                    ) : null}
                  </td>
                  <td>{name(e.paidByMemberId)}</td>
                  <td className="num">
                    <Money paise={e.acceptedAmount ?? e.amount} />
                  </td>
                  <td>
                    {e.status === "approved" ? <Stamp tone="verified">Approved</Stamp> : e.status === "rejected" ? <Pill tone="ledger">Rejected</Pill> : null}
                    {e.status === "pending" && open && e.createdBy !== me.id && e.paidByMemberId !== me.id ? (
                      <span className="flex flex-wrap gap-1">
                        <ActionButton action={approveExpenseAction.bind(null, e.id)} label="Approve" />
                        <ActionForm action={rejectExpenseAction.bind(null, e.id)} className="flex gap-1">
                          <input className="field-input w-32 py-0.5 text-sm" name="reason" placeholder="Reason" required aria-label="Reason" />
                          <SubmitButton variant="danger" size="sm">
                            Reject
                          </SubmitButton>
                        </ActionForm>
                      </span>
                    ) : e.status === "pending" ? (
                      <span className="text-ink-faint">Waiting for partner</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No expenses">Add themes, plugins, stock photos or fonts bought for this project, with the receipt.</Empty>
        )}
        {open ? (
          <details className="mt-4 rounded-md border border-rule p-4">
            <summary className="cursor-pointer font-semibold">Add an expense</summary>
            <ActionForm action={addExpenseAction.bind(null, projectId)} className="mt-3 grid gap-3 sm:grid-cols-3" resetOnSuccess>
              <Field label="Date">
                <input className="field-input" type="date" name="date" defaultValue={today} required />
              </Field>
              <Field label="Vendor">
                <input className="field-input" name="vendor" required />
              </Field>
              <Field label="Amount paid (₹)">
                <input className="field-input" name="amount" inputMode="decimal" required />
              </Field>
              <div className="sm:col-span-2">
                <Field label="What it was for">
                  <input className="field-input" name="description" required />
                </Field>
              </div>
              <Field label="GST in it (₹)">
                <input className="field-input" name="gst" inputMode="decimal" />
              </Field>
              <Field label="Paid by">
                <select className="field-input" name="paid_by" defaultValue={me.id}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} (reimburse)
                    </option>
                  ))}
                  <option value="studio">Studio bank account</option>
                </select>
              </Field>
              <Field label="Receipt">
                <input className="field-input" type="file" name="receipt" />
              </Field>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name="billable" /> Re-billed to the client
              </label>
              <div>
                <SubmitButton variant="secondary">Add expense</SubmitButton>
              </div>
            </ActionForm>
          </details>
        ) : null}
      </Section>
    </>
  );
}
