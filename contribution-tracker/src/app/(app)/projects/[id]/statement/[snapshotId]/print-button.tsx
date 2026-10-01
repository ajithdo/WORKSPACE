"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border border-rule-strong px-3 py-1.5 text-sm font-semibold text-royal print:hidden">
      Print or save as PDF
    </button>
  );
}
