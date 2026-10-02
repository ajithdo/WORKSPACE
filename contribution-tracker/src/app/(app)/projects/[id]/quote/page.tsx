import { eq } from "drizzle-orm";
import { formatDate, Money, Note } from "@/components/ui";
import { getDb } from "@/db";
import { taskInstances } from "@/db/schema";
import { addDaysIso, allocateByWeight, amountInWordsINR, splitGst } from "@/domain/money";
import { PHASE_LABELS, PHASES, type Phase } from "@/domain/types";
import { stateName } from "@/lib/states";
import { requireMember } from "@/lib/session";
import { projectHeader } from "@/server/queries";
import { getStudio } from "@/server/settings";
import { PrintButton } from "../statement/[snapshotId]/print-button";

export const metadata = { title: "Quotation" };

/** Phases the client is not quoted for: sales work, closure admin, studio work. */
const NOT_QUOTED = new Set<string>(["presales", "closure", "studio"]);
const SAC = "998314";

/** Itemised quotation from the plan (SOP G-04): scope by phase priced by planned points, GST treatment, payment schedule, validity. */
export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ valid?: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, client, config } = projectHeader(db, projectId);
  const studio = getStudio(db);
  const validDays = Math.min(90, Math.max(1, Number((await searchParams).valid) || 15));
  const today = new Date().toISOString().slice(0, 10);
  const tasks = db
    .select()
    .from(taskInstances)
    .where(eq(taskInstances.projectId, projectId))
    .all()
    .filter((t) => t.status !== "cancelled" && t.status !== "proposed" && !NOT_QUOTED.has(t.phase) && !t.isSales && !t.isBusinessLevel);
  const phases = PHASES.filter((ph) => tasks.some((t) => t.phase === ph)) as Phase[];
  const weight = (ph: Phase) => tasks.filter((t) => t.phase === ph).reduce((s, t) => s + t.defaultPoints * t.quantity * t.adjustmentFactor, 0);
  const amounts = allocateByWeight(p.quotedAmountExGst, phases.map(weight));
  const gstOn = !!studio?.gstRegistered && p.gstRegistered;
  const supply = p.placeOfSupplyState || client?.stateCode || "";
  const intra = !studio?.stateCode || !supply || studio.stateCode === supply;
  const gst = splitGst(p.quotedAmountExGst, gstOn ? p.gstRateBp : 0, intra);
  const rate = p.gstRateBp / 100;
  const milestoneName = new Map(config.milestones.map((m) => [m.code, m.name]));
  const scheduleAmounts = allocateByWeight(p.quotedAmountExGst, p.paymentSchedule.map((s) => s.pct));
  const quoteNo = `QUO/${p.code}/${today.replace(/-/g, "")}`;

  if (!p.quotedAmountExGst) {
    return (
      <div className="mt-6">
        <Note tone="waiting">Set the quoted amount on the project first (Overview → project details), then come back to print the quotation.</Note>
      </div>
    );
  }
  return (
    <article className="print-area mx-auto mt-6 max-w-3xl text-[15px]">
      <form method="get" className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <label className="text-sm font-semibold">
          Valid for (days)
          <input type="number" name="valid" min={1} max={90} defaultValue={validDays} className="field-input mt-1 block w-28" />
        </label>
        <div className="flex gap-3">
          <button type="submit" className="rounded-md border border-rule-strong px-3 py-1.5 text-sm font-semibold text-royal">
            Update
          </button>
          <PrintButton />
        </div>
      </form>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h2 className="text-xl font-bold">{studio?.legalName || studio?.name}</h2>
          {studio?.address ? <p className="whitespace-pre-line text-sm">{studio.address}</p> : null}
          {studio?.gstin ? <p className="text-sm">GSTIN: {studio.gstin}</p> : null}
        </div>
        <div className="text-right">
          <h3 className="text-2xl font-bold uppercase tracking-wide">Quotation</h3>
          <p className="text-sm">No. {quoteNo}</p>
          <p className="text-sm">Date: {formatDate(today)}</p>
          <p className="text-sm font-semibold">Valid until: {formatDate(addDaysIso(today, validDays))}</p>
        </div>
      </header>
      <section className="grid gap-4 border-b border-rule py-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">For</p>
          <p className="font-bold">{client?.businessName ?? "—"}</p>
          {client?.contactName ? <p className="text-sm">Attn: {client.contactName}</p> : null}
          {client?.gstin ? <p className="text-sm">GSTIN: {client.gstin}</p> : null}
        </div>
        <div className="text-sm sm:text-right">
          <p>
            Project: <strong>{p.name}</strong>
          </p>
          {supply ? <p>Place of supply: {stateName(supply)} ({supply})</p> : null}
        </div>
      </section>
      <table className="ledger-table my-4">
        <thead>
          <tr>
            <th>Scope</th>
            <th className="num">Items</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((ph, i) => (
            <tr key={ph}>
              <td>
                <span className="font-semibold">{PHASE_LABELS[ph]}</span>
                <span className="block text-xs text-ink-soft">
                  {tasks
                    .filter((t) => t.phase === ph)
                    .slice(0, 6)
                    .map((t) => t.name)
                    .join(", ")}
                  {tasks.filter((t) => t.phase === ph).length > 6 ? ", and more" : ""}
                </span>
              </td>
              <td className="num">{tasks.filter((t) => t.phase === ph).length}</td>
              <td className="num">
                <Money paise={amounts[i] ?? 0} />
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td colSpan={2}>Total before GST{gstOn ? ` (SAC ${SAC})` : ""}</td>
            <td className="num">
              <Money paise={p.quotedAmountExGst} />
            </td>
          </tr>
          {gstOn && gst.igst ? (
            <tr>
              <td colSpan={2}>IGST @ {rate}%</td>
              <td className="num">
                <Money paise={gst.igst} />
              </td>
            </tr>
          ) : null}
          {gstOn && !gst.igst ? (
            <>
              <tr>
                <td colSpan={2}>CGST @ {rate / 2}%</td>
                <td className="num">
                  <Money paise={gst.cgst} />
                </td>
              </tr>
              <tr>
                <td colSpan={2}>SGST @ {rate / 2}%</td>
                <td className="num">
                  <Money paise={gst.sgst} />
                </td>
              </tr>
            </>
          ) : null}
          <tr className="font-bold">
            <td colSpan={2}>Total</td>
            <td className="num">
              <Money paise={gst.total} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm">
        In words: <strong>{amountInWordsINR(gst.total)}</strong>
      </p>
      {p.paymentSchedule.length ? (
        <>
          <h4 className="mt-5 font-bold">Payment schedule</h4>
          <table className="ledger-table mt-1 text-sm">
            <tbody>
              {p.paymentSchedule.map((s, i) => (
                <tr key={`${s.milestoneCode}-${i}`}>
                  <td>
                    {s.pct}% {s.note ? `— ${s.note}` : `on ${milestoneName.get(s.milestoneCode) ?? s.milestoneCode}`}
                  </td>
                  <td className="num">
                    <Money paise={scheduleAmounts[i] ?? 0} /> {gstOn ? "+ GST" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <ul className="mt-5 list-disc space-y-1 pl-5 text-sm">
        <li>This quotation is an offer, not a tax invoice. A tax invoice is issued for each payment.</li>
        <li>Work starts after the contract is signed and the advance is received.</li>
        <li>Third-party costs (domain, hosting, paid plugins, stock media) are not included unless listed above.</li>
        <li>This quotation is subject to our standard terms, which are attached.</li>
      </ul>
      <footer className="mt-12 flex justify-end">
        <div className="text-center text-sm">
          <p>For {studio?.legalName || studio?.name}</p>
          <div className="h-14" />
          <p className="border-t border-ink px-6 pt-1">Authorised signatory</p>
        </div>
      </footer>
    </article>
  );
}
