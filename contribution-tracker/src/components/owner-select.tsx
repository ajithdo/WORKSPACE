"use client";

import { useActionState, useRef } from "react";
import type { ActionState } from "@/lib/actions";

/** Changes a task's owner as soon as a different partner is picked. */
export function OwnerSelect({
  action,
  members,
  value,
  disabled,
  label,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  members: { id: number; name: string }[];
  value: number | null;
  disabled?: boolean;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={formAction}>
      <select
        name="owner"
        aria-label={label}
        defaultValue={value ?? ""}
        disabled={disabled || pending}
        onChange={() => ref.current?.requestSubmit()}
        className="w-full rounded border border-rule bg-paper px-1.5 py-0.5 text-sm disabled:border-transparent disabled:bg-transparent disabled:text-ink"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {state?.error ? <span className="block text-xs text-ledger">{state.error}</span> : null}
    </form>
  );
}
