import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { getDb } from "@/db";
import { currentMember } from "@/lib/session";
import { isSetUp } from "@/server/auth";
import { loginAction } from "../auth-actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection(); // decided per request, never at build time
  if (!isSetUp(getDb())) redirect("/setup");
  if (await currentMember()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="ledger-page rounded-lg border border-rule py-8 pr-6 shadow-sm">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-ink-soft">Your studio&apos;s shared ledger of work, evidence and money.</p>
        <ActionForm action={loginAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next ?? "/"} />
          <Field label="Email">
            <input className="field-input" type="email" name="email" autoComplete="username" required />
          </Field>
          <Field label="Password">
            <input className="field-input" type="password" name="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton className="w-full">Sign in</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
