import { eq } from "drizzle-orm";
import { evidenceStrength } from "@/domain/config";
import { findSecrets, SECRET_KIND_LABELS } from "@/domain/secrets";
import type { DbOrTx } from "@/db";
import { changeRequests, communications, evidence, handoverItems, taskInstances } from "@/db/schema";
import type { Ctx } from "./context";
import { iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, loadProject, nonEmpty, projectConfig, requireActor } from "./common";
import { DomainError } from "./errors";
import { fileRow } from "./files";

export type EvidenceSubject = "task" | "communication" | "change_request" | "handover_item";

export interface EvidenceInput {
  subjectType: EvidenceSubject;
  subjectId: number;
  type: string;
  url?: string | null;
  fileId?: number | null;
  externalRef?: string | null;
  description: string;
  capturedAt?: string | null;
  containsPersonalData: boolean;
  redacted: boolean;
  noSecretsConfirmed: boolean;
}

function subjectProject(tx: DbOrTx, type: EvidenceSubject, id: number): { projectId: number; round: number } {
  switch (type) {
    case "task": {
      const t = tx.select().from(taskInstances).where(eq(taskInstances.id, id)).get();
      if (!t) throw new DomainError("not_found", "Task not found");
      if (t.status === "cancelled") throw new DomainError("conflict", "This task is cancelled");
      return { projectId: t.projectId, round: t.submissionRound + 1 };
    }
    case "communication": {
      const c = tx.select().from(communications).where(eq(communications.id, id)).get();
      if (!c) throw new DomainError("not_found", "Communication not found");
      return { projectId: c.projectId, round: 1 };
    }
    case "change_request": {
      const c = tx.select().from(changeRequests).where(eq(changeRequests.id, id)).get();
      if (!c) throw new DomainError("not_found", "Change request not found");
      return { projectId: c.projectId, round: 1 };
    }
    case "handover_item": {
      const h = tx.select().from(handoverItems).where(eq(handoverItems.id, id)).get();
      if (!h) throw new DomainError("not_found", "Handover item not found");
      return { projectId: h.projectId, round: 1 };
    }
  }
}

function rejectSecrets(...values: (string | null | undefined)[]) {
  for (const v of values) {
    if (!v) continue;
    const hit = findSecrets(v)[0];
    if (hit) throw new DomainError("invalid", `This looks like it contains ${SECRET_KIND_LABELS[hit.kind] ?? "a secret"}. Remove it — secrets belong in your password manager, never in evidence.`);
  }
}

export function addEvidence(ctx: Ctx, input: EvidenceInput): { evidenceId: number } {
  const actor = requireActor(ctx);
  if (!input.noSecretsConfirmed) throw new DomainError("invalid", "Please confirm the evidence contains no secrets or customer personal data (or that it is redacted)");
  if (input.containsPersonalData && !input.redacted) throw new DomainError("invalid", "Customer personal data must be redacted before it is added as evidence");
  const description = nonEmpty(input.description, "Description");
  if (description.length < 10 || description.length > 300) throw new DomainError("invalid", "Description must be 10–300 characters");
  const url = input.url?.trim() || null;
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new DomainError("invalid", "Links must start with http:// or https://");
  const externalRef = input.externalRef?.trim() || null;
  rejectSecrets(description, url, externalRef);
  if (!url && !input.fileId && !externalRef) throw new DomainError("invalid", "Add a link, a file or a reference (commit, invoice or bank reference)");
  return ctx.db.transaction((tx) => {
    const { projectId, round } = subjectProject(tx, input.subjectType, input.subjectId);
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    const cfg = projectConfig(tx, p);
    if (!cfg.evidence_types.some((e) => e.code === input.type)) throw new DomainError("invalid", "Unknown evidence type");
    let sha256: string | null = null;
    if (input.fileId) {
      const f = fileRow(tx, input.fileId);
      if (f.projectId !== null && f.projectId !== p.id) throw new DomainError("invalid", "That file belongs to another project");
      sha256 = f.sha256;
    }
    const id = tx
      .insert(evidence)
      .values({
        projectId: p.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        submissionRound: round,
        submittedBy: actor,
        submittedAt: iso(ctx.now),
        type: input.type,
        strength: evidenceStrength(cfg, input.type),
        url,
        fileId: input.fileId ?? null,
        externalRef,
        description,
        capturedAt: input.capturedAt ?? null,
        sha256,
        containsPersonalData: input.containsPersonalData,
        redacted: input.redacted,
        noSecretsConfirmed: true,
      })
      .returning({ id: evidence.id })
      .get().id;
    audit(tx, ctx, "evidence.add", "evidence", id, p.id, undefined, { subject: `${input.subjectType}:${input.subjectId}`, type: input.type, round, sha256 });
    return { evidenceId: id };
  });
}

export function reviewEvidence(ctx: Ctx, evidenceId: number, input: { status: "accepted" | "rejected"; reason?: string }) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const e = tx.select().from(evidence).where(eq(evidence.id, evidenceId)).get();
    if (!e) throw new DomainError("not_found", "Evidence not found");
    const p = loadProject(tx, e.projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, p.id, actor);
    if (e.submittedBy === actor) throw new DomainError("forbidden", "Evidence is checked by the other partner, not the person who added it");
    const reason = input.status === "rejected" ? nonEmpty(input.reason, "A reason") : null;
    tx.update(evidence).set({ verificationStatus: input.status, verifiedBy: actor, verifiedAt: iso(ctx.now), rejectionReason: reason }).where(eq(evidence.id, evidenceId)).run();
    audit(tx, ctx, `evidence.${input.status === "accepted" ? "accept" : "reject"}`, "evidence", evidenceId, p.id, { status: e.verificationStatus }, { status: input.status, reason });
  });
}

export function evidenceFor(tx: DbOrTx, subjectType: EvidenceSubject, subjectId: number) {
  return tx
    .select()
    .from(evidence)
    .where(eq(evidence.subjectType, subjectType))
    .all()
    .filter((e) => e.subjectId === subjectId)
    .sort((a, b) => a.id - b.id);
}
