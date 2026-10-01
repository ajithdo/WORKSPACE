"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  count?: number;
}

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((i) => {
        const active = isActive(path, i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between rounded-md px-3 py-1.5 font-semibold ${active ? "bg-white/12 text-white" : "text-white/75 hover:bg-white/8 hover:text-white"}`}
          >
            <span>{i.label}</span>
            {i.count ? <span className="min-w-6 rounded-full bg-ledger px-1.5 text-center text-xs leading-5 text-white">{i.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Tabs({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Project sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-rule pb-px lg:flex-wrap lg:overflow-visible">
      {items.map((i) => {
        const active = i.href.split("/").length <= 3 ? path === i.href : isActive(path, i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${active ? "border-ledger text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >
            {i.label}
            {i.count ? <span className="ml-1.5 rounded-full bg-waiting-wash px-1.5 text-xs text-waiting">{i.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
