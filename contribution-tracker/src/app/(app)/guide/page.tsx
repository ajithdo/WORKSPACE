import Link from "next/link";
import { PageHeader, Section } from "@/components/ui";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { activeConfig } from "@/server/versions";

export const metadata = { title: "How it works" };

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Plain-language rules for the partners, with the numbers taken from the active rules version. */
export default async function GuidePage() {
  await requireMember();
  const { version, data } = activeConfig(getDb());
  const c = data.calculation;
  const distributable = 1 - c.reserve_pct;
  return (
    <>
      <PageHeader title="How it works" subtitle={`The studio's rules in plain words. Numbers come from the active rules (v${version}); both partners can change them under Studio and rules.`} />
      <Section title="1. Plan the project together">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>A new project starts with the tasks for its kind of site, each with points from the task library. Nobody types their own points.</li>
          <li>Set owners and shares, then send the plan to your partner. It locks when both of you approve.</li>
          <li>After the lock, new work is proposed as a task. It is approved by your partner, or automatically after {c.auto_approve_hours} hours of silence.</li>
        </ul>
      </Section>
      <Section title="2. Do the work, show it, get it checked">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Start the task, then add evidence: a commit, pull request, deploy link, signed document or similar.</li>
          <li>
            Tasks worth more than {c.evidence_rule.strong_required_above_points} points need strong evidence. Smaller ones need at least {c.evidence_rule.min_strength_otherwise} evidence.
          </li>
          <li>Submit, and your partner verifies it. Only verified work earns points, and you can never verify your own work.</li>
          <li>Hard gates protect the studio: no design or build before the contract and advance, and no ownership transfer before the final payment.</li>
        </ul>
      </Section>
      <Section title="3. How points become money">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Start from the cash actually received, without GST. TDS is a tax credit and is {c.distribute_tds_credit ? "included" : "not shared out until your CA advises"}.</li>
          <li>Repay approved project expenses to whoever paid them.</li>
          <li>Keep {pct(c.reserve_pct)} of the rest as the studio reserve.</li>
          <li>
            Split the remaining {pct(distributable)}: {pct(c.base_share_pct)} of it equally between the partners, and {pct(c.pool_pct)} by each partner&apos;s share of verified points.
          </li>
        </ol>
        <p className="mt-2 text-sm text-ink-soft">
          Caps keep delivery work at the centre: meetings and calls can be at most {pct(c.communication_cap_pct)} of a project&apos;s points, and sales work (including the {pct(c.origination_credit_pct)} credit for
          bringing the client in) at most {pct(c.sales_cap_pct)}. Small {c.micro_task_points_threshold}-point tasks count up to {pct(c.micro_task_cap_pct)} of each partner&apos;s points. Fixing your own bug
          earns {c.own_defect_fix_points} points.
        </p>
        <p className="mt-2 text-sm">
          See the live split on each project&apos;s <strong>Contribution</strong> tab, and the year&apos;s totals in <Link href="/summary" className="font-semibold text-royal hover:underline">Year at a glance</Link>.
        </p>
      </Section>
      <Section title="4. When you disagree">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Raise a dispute within {c.dispute_window_days} days of verification. While it is open, those points are held out of the split.</li>
          <li>
            Agree on an outcome together. If you have not agreed after {c.dispute_default_resolution_days} days, the disputed points are split 50/50, unless either of you escalates to the CA or mediator named in your deed.
          </li>
          <li>Effort adjustments (between {c.adjustment_min}× and {c.adjustment_max}×) always need the other partner&apos;s approval and a reason.</li>
        </ul>
      </Section>
      <Section title="5. Closing a project">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Every task must be verified or cancelled, disputes settled, invoices paid or written off, and the handover finished.</li>
          <li>The app computes the final split. Both partners approve it, and it is locked with a fingerprint (hash) that can be re-checked at any time.</li>
          <li>Nothing is edited after that. A later correction is a new adjustment, and it also needs both partners.</li>
        </ul>
      </Section>
    </>
  );
}
