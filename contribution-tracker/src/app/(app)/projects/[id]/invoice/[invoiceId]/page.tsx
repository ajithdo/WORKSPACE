import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { formatDate, Money } from "@/components/ui";
import { getDb } from "@/db";
import { invoices } from "@/db/schema";
import { amountInWordsINR } from "@/domain/money";
import { stateName } from "@/lib/states";
import { requireMember } from "@/lib/session";
import { projectHeader } from "@/server/queries";
import { getStudio } from "@/server/settings";
import { PrintButton } from "../../statement/[snapshotId]/print-button";

export const metadata = { title: "Tax invoice" };

/** SAC 998314: IT design and development services (websites). */
const SAC = "998314";

const INVOICE_KIND: Record<string, string> = {
  advance: "Advance payment",
  milestone: "Milestone payment",
  final: "Final payment",
  change_request: "Change request",
  amc: "Annual maintenance",
};

/** Printable tax invoice with the particulars required by rule 46 of the CGST Rules. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  await requireMember();
  const { id, invoiceId } = await params;
  const db = getDb();
  const inv = db.select().from(invoices).where(eq(invoices.id, Number(invoiceId))).get();
  if (!inv || inv.projectId !== Number(id)) notFound();
  const { project: p, client } = projectHeader(db, inv.projectId);
  const studio = getStudio(db);
  const draft = !inv.number;
  // Issued invoices print the details stored at issue; drafts (and invoices issued before that existed) use current ones.
  const parties = inv.parties ?? {
    supplier: { name: studio?.legalName || studio?.name || "", address: studio?.address ?? "", gstin: studio?.gstin ?? "", stateCode: studio?.stateCode ?? "", udyamNumber: studio?.udyamNumber ?? "", gstRegistered: !!studio?.gstRegistered, msmeRegistered: !!studio?.msmeRegistered },
    recipient: { name: client?.businessName ?? "", address: client?.address ?? "", gstin: client?.gstin ?? "", stateCode: client?.stateCode ?? "", contactName: client?.contactName ?? "" },
    placeOfSupply: p.placeOfSupplyState || client?.stateCode || "",
  };
  const { supplier, recipient } = parties;
  const gst = supplier.gstRegistered;
  const rate = inv.gstRateBp / 100;
  const supplyState = parties.placeOfSupply;
  const kind = INVOICE_KIND[inv.type] ?? inv.type.replace(/_/g, " ");
  const description = `${kind}: website design and development, ${p.name}${inv.milestoneCode ? ` (milestone ${inv.milestoneCode})` : ""}`;
  return (
    <article className="print-area mx-auto max-w-3xl text-[15px]">
      <div className="mb-4 flex items-center justify-between gap-4 print:hidden">
        <p className="text-sm text-ink-soft">{draft ? "Draft: the number is assigned when the invoice is issued." : "Check the details, then print or save as PDF."}</p>
        <PrintButton />
      </div>
      {draft ? <p className="mb-3 rounded border border-ledger px-3 py-1 text-center font-bold uppercase tracking-wide text-ledger">Draft, not a valid invoice</p> : null}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h2 className="text-xl font-bold">{supplier.name}</h2>
          {supplier.address ? <p className="whitespace-pre-line text-sm">{supplier.address}</p> : null}
          <p className="text-sm">
            State: {stateName(supplier.stateCode)} ({supplier.stateCode})
          </p>
          {supplier.gstin ? <p className="text-sm">GSTIN: {supplier.gstin}</p> : null}
          {supplier.msmeRegistered && supplier.udyamNumber ? <p className="text-sm">Udyam: {supplier.udyamNumber}</p> : null}
        </div>
        <div className="text-right">
          <h3 className="text-2xl font-bold uppercase tracking-wide">{gst ? "Tax invoice" : "Invoice"}</h3>
          <p>
            No. <strong>{inv.number ?? "DRAFT"}</strong>
          </p>
          <p className="text-sm">Date: {formatDate(inv.issueDate)}</p>
          <p className="text-sm">Due: {formatDate(inv.msmeDueDate && inv.msmeDueDate < inv.dueDate ? inv.msmeDueDate : inv.dueDate)}</p>
        </div>
      </header>
      <section className="grid gap-4 border-b border-rule py-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Bill to</p>
          <p className="font-bold">{recipient.name || "—"}</p>
          {recipient.address ? <p className="whitespace-pre-line text-sm">{recipient.address}</p> : null}
          {recipient.gstin ? <p className="text-sm">GSTIN: {recipient.gstin}</p> : <p className="text-sm">Unregistered recipient</p>}
        </div>
        <div className="text-sm sm:text-right">
          <p>
            Place of supply: <strong>{stateName(supplyState)}</strong> ({supplyState})
          </p>
          <p>Project: {p.code}</p>
          {gst ? <p>Tax payable on reverse charge: No</p> : null}
        </div>
      </section>
      <table className="ledger-table my-4">
        <thead>
          <tr>
            <th>Description</th>
            {gst ? <th>SAC</th> : null}
            <th className="num">Taxable value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{description}</td>
            {gst ? <td>{SAC}</td> : null}
            <td className="num">
              <Money paise={inv.amountExGst} />
            </td>
          </tr>
          {gst && inv.igst ? (
            <tr>
              <td colSpan={2}>IGST @ {rate}%</td>
              <td className="num">
                <Money paise={inv.igst} />
              </td>
            </tr>
          ) : null}
          {gst && !inv.igst && (inv.cgst || inv.sgst) ? (
            <>
              <tr>
                <td colSpan={2}>CGST @ {rate / 2}%</td>
                <td className="num">
                  <Money paise={inv.cgst} />
                </td>
              </tr>
              <tr>
                <td colSpan={2}>SGST @ {rate / 2}%</td>
                <td className="num">
                  <Money paise={inv.sgst} />
                </td>
              </tr>
            </>
          ) : null}
          <tr className="font-bold">
            <td colSpan={gst ? 2 : 1}>Total</td>
            <td className="num">
              <Money paise={inv.total} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm">
        Amount in words: <strong>{amountInWordsINR(inv.total)}</strong>
      </p>
      {inv.tdsExpectedRateBp ? <p className="mt-1 text-sm">If you deduct TDS ({inv.tdsExpectedRateBp / 100}%), please share the TDS certificate (Form 16A) so we can claim the credit.</p> : null}
      {supplier.msmeRegistered ? (
        <p className="mt-1 text-sm">We are a Udyam-registered micro or small enterprise. Under the MSMED Act 2006, payment is due within 45 days of acceptance, after which compound interest applies.</p>
      ) : null}
      {inv.notes ? <p className="mt-3 whitespace-pre-line text-sm">{inv.notes}</p> : null}
      <footer className="mt-12 flex justify-end">
        <div className="text-center text-sm">
          <p>For {supplier.name}</p>
          <div className="h-14" />
          <p className="border-t border-ink px-6 pt-1">Authorised signatory</p>
        </div>
      </footer>
    </article>
  );
}
