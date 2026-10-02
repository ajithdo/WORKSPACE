import { SideNav } from "@/components/nav";
import { getDb } from "@/db";
import { requireMember } from "@/lib/session";
import { inboxFor } from "@/server/inbox";
import { getStudio } from "@/server/settings";
import { logoutAction } from "../auth-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const db = getDb();
  const studio = getStudio(db);
  const inboxCount = inboxFor(db, member.id, new Date()).length;
  const nav = [
    { href: "/", label: "Needs your action", count: inboxCount },
    { href: "/projects", label: "Projects" },
    { href: "/summary", label: "Year at a glance" },
    { href: "/library", label: "Task library" },
    { href: "/settings", label: "Studio and rules" },
    { href: "/audit", label: "Audit log" },
  ];
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[15rem_1fr] print:block">
      <aside className="bg-ink text-white md:sticky md:top-0 md:h-dvh print:hidden">
        <details className="group md:hidden" open={false}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
            <span className="font-bold">{studio?.name ?? "Studio"}</span>
            <span className="text-sm text-white/70">
              Menu{inboxCount ? <span className="ml-2 rounded-full bg-ledger px-1.5 text-xs text-white">{inboxCount}</span> : null}
            </span>
          </summary>
          <div className="space-y-4 px-3 pb-4">
            <SideNav items={nav} />
            <SignOut name={member.name} />
          </div>
        </details>
        <div className="hidden h-full flex-col justify-between p-4 md:flex">
          <div>
            <p className="mb-1 px-3 text-lg font-bold leading-tight">{studio?.name ?? "Studio"}</p>
            <p className="mb-5 px-3 text-sm text-white/60">Contribution ledger</p>
            <SideNav items={nav} />
          </div>
          <SignOut name={member.name} />
        </div>
      </aside>
      <main className="min-w-0 px-3 py-4 md:px-8 md:py-8">
        {member.mustChangePassword ? (
          <p role="alert" className="mx-auto mb-3 max-w-6xl rounded-md border border-ledger/40 bg-ledger/5 px-4 py-2 text-sm">
            You signed in with a temporary password. <a href="/settings#password" className="font-semibold text-royal underline">Choose your own password</a> before you continue.
          </p>
        ) : null}
        <div className="ledger-page mx-auto min-h-[calc(100dvh-4rem)] max-w-6xl rounded-lg border border-rule py-6 pr-4 shadow-sm md:py-8 md:pr-8">{children}</div>
      </main>
    </div>
  );
}

function SignOut({ name }: { name: string }) {
  return (
    <form action={logoutAction} className="flex items-center justify-between border-t border-white/15 px-3 pt-3 text-sm">
      <span className="text-white/80">Signed in as {name}</span>
      <button type="submit" className="font-semibold text-white/90 underline-offset-2 hover:underline">
        Sign out
      </button>
    </form>
  );
}
