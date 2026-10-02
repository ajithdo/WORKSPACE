import { ShareText } from "@/components/share-text";

/** Shows a ready-to-send reminder; the partner sends it from their own WhatsApp or email. */
export function ReminderPanel({ tone, daysOverdue, subject, body, email, whatsapp }: { tone: string; daysOverdue: number; subject: string; body: string; email: string; whatsapp: string | null }) {
  return (
    <details className="mt-2 rounded-md border border-ledger/40 bg-ledger/5 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold text-ledger">
        Remind the client ({daysOverdue} days overdue, {tone} reminder)
      </summary>
      <div className="mt-2">
        <ShareText label="Message (edit before sending)" text={body} subject={subject} phone={whatsapp} email={email} />
        <p className="mt-1 text-xs text-ink-faint">After sending, log it under Communications as a payment follow-up so it is on record.</p>
      </div>
    </details>
  );
}
