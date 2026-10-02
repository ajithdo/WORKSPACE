"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  showSuccess = true,
  id,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      {state?.error ? (
        <p role="alert" className="mt-2 rounded-md border border-ledger/30 bg-ledger-wash px-3 py-2 text-sm text-ledger">
          {state.error}
        </p>
      ) : null}
      {state?.ok && showSuccess && state.message ? (
        <p role="status" className="mt-2 text-sm text-verified">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

const VARIANTS = {
  primary: "bg-royal text-white hover:bg-royal-dark border border-royal",
  secondary: "bg-paper text-royal border border-rule-strong hover:border-royal",
  danger: "bg-paper text-ledger border border-ledger/50 hover:bg-ledger-wash",
  quiet: "bg-transparent text-royal border border-transparent hover:underline px-1",
} as const;

export function SubmitButton({
  children,
  variant = "primary",
  confirm,
  name,
  value,
  className = "",
  size = "md",
  disabled = false,
}: {
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
  confirm?: string;
  name?: string;
  value?: string;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors disabled:opacity-60 ${
        size === "sm" ? "px-2.5 py-1 text-sm" : "px-4 py-2"
      } ${VARIANTS[variant]} ${className}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** A one-button form for state changes ("Verify", "Approve"). */
export function ActionButton({
  action,
  label,
  variant = "primary",
  confirm,
  size = "sm",
  hidden,
}: {
  action: Action;
  label: string;
  variant?: keyof typeof VARIANTS;
  confirm?: string;
  size?: "sm" | "md";
  hidden?: Record<string, string | number>;
}) {
  return (
    <ActionForm action={action} className="inline-block" showSuccess={false}>
      {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />) : null}
      <SubmitButton variant={variant} confirm={confirm} size={size}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
