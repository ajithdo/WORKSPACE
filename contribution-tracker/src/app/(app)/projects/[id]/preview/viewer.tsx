"use client";

import { useState } from "react";

const SIZES = [
  { key: "phone", label: "Phone", w: 390, h: 844 },
  { key: "tablet", label: "Tablet", w: 820, h: 1180 },
  { key: "desktop", label: "Desktop", w: 1440, h: 900 },
] as const;

export function SiteViewer({ urls }: { urls: { label: string; url: string }[] }) {
  const [url, setUrl] = useState(urls[0]?.url ?? "");
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES[0]);
  const [key, setKey] = useState(0);
  const scale = Math.min(1, 900 / size.w);
  if (!urls.length) return null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="field-input w-auto" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Which site">
          {urls.map((u) => (
            <option key={u.url} value={u.url}>
              {u.label}: {u.url}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Screen size" className="flex gap-1">
          {SIZES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSize(s)}
              aria-pressed={size.key === s.key}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${size.key === s.key ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft"}`}
            >
              {s.label} {s.w}px
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setKey((k) => k + 1)} className="text-sm font-semibold text-royal hover:underline">
          Reload
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-royal hover:underline">
          Open in a new tab
        </a>
      </div>
      <div className="overflow-auto rounded-md border border-rule bg-page p-3" style={{ height: size.h * scale + 24 }}>
        <iframe
          key={`${url}-${key}`}
          src={url}
          title="Site preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, background: "white" }}
        />
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        Blank frame? The site may refuse to be shown inside another page (X-Frame-Options or CSP frame-ancestors) — use “Open in a new tab”. A localhost address only works on the computer running that
        site, and your browser may ask to allow local network access.
      </p>
    </div>
  );
}
