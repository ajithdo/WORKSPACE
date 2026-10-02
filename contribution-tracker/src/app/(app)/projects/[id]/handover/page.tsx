import { ActionForm, SubmitButton } from "@/components/forms";
import { Note, Pill, Section, Stamp } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { handoverStatus } from "@/server/handover";
import { projectHeader } from "@/server/queries";
import { updateHandoverAction } from "./actions";

export const metadata = { title: "Handover" };

const label = (code: string) => code.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const projectId = Number((await params).id);
  const db = getDb();
  const { project: p, config } = projectHeader(db, projectId);
  const h = handoverStatus(db, projectId);
  const guide = new Map(config.handover_items.map((i) => [i.code, i]));
  const open = p.closeStatus !== "closed_locked";
  return (
    <>
      <Note tone={h.complete ? "verified" : "neutral"}>
        {h.complete ? (
          <strong>Handover complete.</strong>
        ) : (
          <>
            <strong>
              {h.done} of {h.applicable} applicable items done.
            </strong>{" "}
          </>
        )}{" "}
        Ownership transfer (M10) completes when every applicable item is verified by the client, credentials the studio knew are rotated, and studio access is removed — or reduced only while an annual
        maintenance contract is active{h.amcActive ? " (it is)" : ""}. Never put passwords here; record only who owns what.
      </Note>
      <Section title="Checklist" description="Mark items that do not exist on this project as not applicable.">
        <ul className="divide-y divide-rule">
          {h.items.map((i) => {
            const g = guide.get(i.code);
            return (
              <li key={i.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-semibold">{label(i.code)}</span>
                    {i.status === "verified_by_client" && i.blockers.length === 0 ? (
                      <Stamp tone="verified">Done</Stamp>
                    ) : i.status === "not_applicable" ? (
                      <Pill>Not applicable</Pill>
                    ) : (
                      <Pill tone="waiting">{i.status.replaceAll("_", " ")}</Pill>
                    )}
                    {i.blockers.length && i.status !== "not_applicable" ? <span className="text-sm text-ink-soft">{i.blockers.join("; ")}</span> : null}
                  </summary>
                  <p className="mt-2 text-sm text-ink-soft">
                    Should be owned by: {g?.should_own}. How: {g?.transfer}.
                  </p>
                  {open ? (
                    <ActionForm action={updateHandoverAction.bind(null, i.id)} className="mt-2 grid gap-2 sm:grid-cols-3">
                      <label className="text-sm">
                        <span className="mb-1 block font-semibold">Status</span>
                        <select className="field-input" name="status" defaultValue={i.status}>
                          {config.handover_item_status.map((s) => (
                            <option key={s} value={s}>
                              {s.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block font-semibold">Owned by (account)</span>
                        <input className="field-input" name="owner_confirmed" defaultValue={i.ownerConfirmed} placeholder="Client's own registrar account" />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block font-semibold">Studio access now</span>
                        <select className="field-input" name="developer_access" defaultValue={i.developerAccess ?? ""}>
                          <option value="">Not recorded</option>
                          {config.developer_access_values.map((v) => (
                            <option key={v} value={v}>
                              {v.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="credentials_exist" defaultChecked={i.credentialsExist} /> Has credentials the studio knew
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="credentials_rotated" defaultChecked={i.credentialsRotated} /> Rotated{i.rotatedOn ? ` on ${i.rotatedOn}` : ""}
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block font-semibold">Why access is kept</span>
                        <input className="field-input" name="retained_reason" defaultValue={i.retainedReason ?? ""} />
                      </label>
                      <label className="text-sm sm:col-span-2">
                        <span className="mb-1 block font-semibold">Notes (no passwords)</span>
                        <input className="field-input" name="notes" defaultValue={i.notes} />
                      </label>
                      <div className="self-end">
                        <SubmitButton variant="secondary" size="sm">
                          Save
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
