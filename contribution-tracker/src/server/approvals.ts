import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { approvalVotes } from "@/db/schema";
import { iso } from "./context";
import { DomainError } from "./errors";

export type VoteSubject = "plan" | "snapshot" | "post_lock_adjustment" | "task_verify" | "library_version" | "config_version";

export function votes(tx: DbOrTx, subjectType: VoteSubject, subjectId: number, round: number) {
  return tx
    .select()
    .from(approvalVotes)
    .where(and(eq(approvalVotes.subjectType, subjectType), eq(approvalVotes.subjectId, subjectId), eq(approvalVotes.round, round)))
    .all();
}

export function castVote(
  tx: DbOrTx,
  v: { subjectType: VoteSubject; subjectId: number; round: number; memberId: number; decision: "approve" | "reject"; note?: string; now: Date; label: string },
) {
  if (votes(tx, v.subjectType, v.subjectId, v.round).some((x) => x.memberId === v.memberId)) {
    throw new DomainError("conflict", `You have already approved this ${v.label}`);
  }
  tx.insert(approvalVotes)
    .values({ subjectType: v.subjectType, subjectId: v.subjectId, round: v.round, memberId: v.memberId, decision: v.decision, note: v.note ?? "", createdAt: iso(v.now) })
    .run();
}

export function allApproved(tx: DbOrTx, subjectType: VoteSubject, subjectId: number, round: number, required: number[]): boolean {
  const approved = new Set(
    votes(tx, subjectType, subjectId, round)
      .filter((x) => x.decision === "approve")
      .map((x) => x.memberId),
  );
  return required.every((m) => approved.has(m));
}

export function hasVoted(tx: DbOrTx, subjectType: VoteSubject, subjectId: number, round: number, memberId: number): boolean {
  return votes(tx, subjectType, subjectId, round).some((x) => x.memberId === memberId);
}
