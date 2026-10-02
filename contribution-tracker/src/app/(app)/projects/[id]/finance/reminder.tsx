"use client";

import { useState } from "react";

/** Shows a ready-to-send reminder; the partner sends it from their own WhatsApp or email. */
export function ReminderPanel({ tone, daysOverdue, subject, body, email, whatsapp }: { tone: string; daysOverdue: number; subject: string; body: string; email: string; whatsapp: string | null }) {
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState(false);
  return (
    <details className="mt-2 rounded-md border border-ledger/40 bg-ledger/5 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold text-ledger">
        Remind the client ({daysOverdue} days overdue, {tone} reminder)
      </summary>
      <label className="mt-2 block text-xs font-semibold text-ink-soft" htmlFor={`reminder-${subject}`}>
        Message (edit before sending)
      </label>
      <textarea id={`reminder-${subject}`} className="field-input mt-1 h-48 w-full font-normal" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-3">
        {whatsapp ? (
          <a className="font-semibold text-royal hover:underline" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            Open in WhatsApp
          </a>
        ) : null}
        {email ? (
          <a className="font-semibold text-royal hover:underline" href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>
            Open in email
          </a>
        ) : null}
        <button
          type="button"
          className="font-semibold text-royal hover:underline"
          onClick={() => {
            navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy text"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-faint">After sending, log it under Communications so the follow-up is on record.</p>
    </details>
  );
}
