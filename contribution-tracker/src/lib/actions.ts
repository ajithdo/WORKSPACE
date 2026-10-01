import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { Ctx } from "@/server/context";
import { DomainError } from "@/server/errors";
import { requestCtx } from "./session";

export type ActionState = { ok: boolean; error?: string; message?: string; at: number } | null;

/**
 * Wraps a server action: signs the request in, runs the service, refreshes the page.
 * Business-rule failures come back as a readable error next to the form; nothing else leaks.
 */
export async function runAction(fn: (ctx: Ctx) => unknown, message = "Saved"): Promise<ActionState> {
  try {
    const ctx = await requestCtx();
    await fn(ctx);
    refresh();
    return { ok: true, message, at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  const code = (e as { code?: string })?.code;
  if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) {
    const msg = (e as Error).message;
    if (/closed and locked|locked task|locked snapshot|append-only|cannot be (edited|deleted|changed)|draft plan/.test(msg)) return `Not allowed: ${msg}`;
    if (code === "SQLITE_CONSTRAINT_UNIQUE") return "That already exists";
    return "This change conflicts with existing records";
  }
  console.error(e);
  return "Something went wrong. The change was not saved.";
}
