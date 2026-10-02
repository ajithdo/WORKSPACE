import { bool, optStr, str } from "@/lib/form";
import type { Ctx } from "@/server/context";
import { DomainError } from "@/server/errors";
import { addEvidence, type EvidenceSubject } from "@/server/evidence";
import { storeFile } from "@/server/files";

// Kept out of "use server" files: every export there becomes a callable endpoint.
/** Shared by every page that collects evidence: stores the optional file, then the evidence record. */
export async function addEvidenceFor(ctx: Ctx, subjectType: EvidenceSubject, subjectId: number, projectId: number, fd: FormData) {
  if (!bool(fd, "no_secrets")) throw new DomainError("invalid", "Please confirm the evidence contains no secrets or customer personal data (or that it is redacted)");
  const description = str(fd, "description");
  if (description.length < 10 || description.length > 300) throw new DomainError("invalid", "Description must be 10–300 characters");
  let fileId: number | null = null;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    fileId = storeFile(ctx, { projectId, category: str(fd, "file_category") || "11_internal", name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }).fileId;
  }
  return addEvidence(ctx, {
    subjectType,
    subjectId,
    type: str(fd, "type"),
    url: optStr(fd, "url"),
    externalRef: optStr(fd, "external_ref"),
    fileId,
    description,
    capturedAt: optStr(fd, "captured_at"),
    containsPersonalData: bool(fd, "personal_data"),
    redacted: bool(fd, "redacted"),
    noSecretsConfirmed: true,
  });
}
