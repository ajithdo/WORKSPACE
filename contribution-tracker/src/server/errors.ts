export type DomainErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "locked" | "gate_blocked" | "evidence_insufficient" | "unauthenticated";

/** An expected business-rule failure. Its message is safe to show to the user. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function invariant(condition: unknown, code: DomainErrorCode, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
