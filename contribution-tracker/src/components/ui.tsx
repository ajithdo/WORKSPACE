import Link from "next/link";
import { formatINR } from "@/domain/money";

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink md:text-[1.75rem]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, description, actions, children, id }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-10 scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2">
        <div>
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {description ? <p className="text-sm text-ink-soft">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Money({ paise, className = "" }: { paise: number; className?: string }) {
  return <span className={`tabular-nums ${paise < 0 ? "text-ledger" : ""} ${className}`}>{formatINR(paise)}</span>;
}

export function Points({ value, className = "" }: { value: number; className?: string }) {
  const v = Math.round(value * 100) / 100;
  return <span className={`tabular-nums ${className}`}>{Number.isInteger(v) ? v : v.toFixed(2)}</span>;
}

const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  proposed: { label: "Proposed", cls: "bg-waiting-wash text-waiting" },
  planned: { label: "Planned", cls: "bg-page text-ink-soft" },
  in_progress: { label: "In progress", cls: "bg-royal-wash text-royal" },
  blocked: { label: "Blocked", cls: "bg-ledger-wash text-ledger" },
  submitted: { label: "Awaiting check", cls: "bg-waiting-wash text-waiting" },
  verified: { label: "Verified", cls: "stamp text-verified" },
  locked: { label: "Locked", cls: "stamp text-ledger" },
  cancelled: { label: "Cancelled", cls: "text-ink-faint line-through" },
};

export function TaskStatus({ status }: { status: string }) {
  const s = TASK_STATUS[status] ?? { label: status, cls: "bg-page text-ink-soft" };
  if (s.cls.startsWith("stamp")) return <span className={s.cls}>{s.label}</span>;
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-sm font-semibold ${s.cls}`}>{s.label}</span>;
}

const TONES = {
  neutral: "bg-page text-ink-soft border-rule",
  royal: "bg-royal-wash text-royal border-royal/20",
  waiting: "bg-waiting-wash text-waiting border-waiting/20",
  ledger: "bg-ledger-wash text-ledger border-ledger/20",
  verified: "bg-verified-wash text-verified border-verified/20",
} as const;

export type Tone = keyof typeof TONES;

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-sm font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Stamp({ tone, children }: { tone: "verified" | "ledger" | "royal"; children: React.ReactNode }) {
  const color = tone === "verified" ? "text-verified" : tone === "ledger" ? "text-ledger" : "text-royal";
  return <span className={`stamp ${color}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-rule-strong px-5 py-6 text-ink-soft">
      <p className="font-semibold text-ink">{title}</p>
      {children ? <div className="mt-1 text-sm">{children}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function TextLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`font-semibold text-royal underline-offset-2 hover:underline ${className}`}>
      {children}
    </Link>
  );
}

export function KeyValue({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-1.5 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Note({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <div className={`rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}>{children}</div>;
}

export function ScrollTable({ children }: { children: React.ReactNode }) {
  return <div className="-mx-2 overflow-x-auto px-2">{children}</div>;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
