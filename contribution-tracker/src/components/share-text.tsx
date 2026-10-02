"use client";

import { useState } from "react";

/** Editable message with copy, WhatsApp and email buttons; the partner sends it themselves. */
export function ShareText({ text, subject, phone, email, label }: { text: string; subject: string; phone: string | null; email: string; label: string }) {
  const [value, setValue] = useState(text);
  const [copied, setCopied] = useState(false);
  return (
    <div className="print:hidden">
      <label htmlFor="share-text" className="text-sm font-semibold">
        {label}
      </label>
      <textarea id="share-text" className="field-input mt-1 h-64 w-full font-normal" value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <button
          type="button"
          className="font-semibold text-royal hover:underline"
          onClick={() => {
            navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy text"}
        </button>
        {phone ? (
          <a className="font-semibold text-royal hover:underline" href={`https://wa.me/${phone}?text=${encodeURIComponent(value)}`} target="_blank" rel="noopener noreferrer">
            Open in WhatsApp
          </a>
        ) : null}
        {email ? (
          <a className="font-semibold text-royal hover:underline" href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(value.replace(/\*/g, ""))}`}>
            Open in email
          </a>
        ) : null}
      </div>
    </div>
  );
}
