import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { findSecrets, SECRET_KIND_LABELS } from "@/domain/secrets";
import { sha256Hex } from "@/domain/canonical";
import { dataDir, type DbOrTx } from "@/db";
import { files } from "@/db/schema";
import type { Ctx } from "./context";
import { iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, loadProject, projectConfig, requireActor } from "./common";
import { DomainError } from "./errors";

const RISKY_NAMES = /(^\.env(\..*)?$)|(^id_(rsa|dsa|ecdsa|ed25519)$)|(\.(pem|key|p12|pfx|kdbx|keystore|jks|ppk|ovpn)$)|(^credentials(\.json)?$)/i;
const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|x-sh))/;

export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB ?? 15);
  return (Number.isFinite(mb) && mb > 0 ? mb : 15) * 1024 * 1024;
}

export function filesDir(): string {
  return path.join(dataDir(), "files");
}

export function sanitiseFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return base.slice(0, 180) || "file";
}

export interface StoreFileInput {
  projectId: number | null;
  category: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
  visibility?: "internal" | "client_shared";
}

/** Content-addressed storage: identical uploads share one copy on disk; every upload gets its own row and hash. */
export function storeFile(ctx: Ctx, input: StoreFileInput): { fileId: number; sha256: string } {
  const actor = requireActor(ctx);
  const name = sanitiseFileName(input.name);
  if (input.bytes.byteLength === 0) throw new DomainError("invalid", "The file is empty");
  if (input.bytes.byteLength > maxUploadBytes()) throw new DomainError("invalid", `Files can be at most ${Math.round(maxUploadBytes() / 1048576)} MB`);
  if (RISKY_NAMES.test(name)) throw new DomainError("invalid", "This kind of file usually holds passwords or keys. Keep secrets in your password manager, not in the app.");
  const mime = input.mime || "application/octet-stream";
  if (TEXT_MIME.test(mime) || /\.(txt|csv|json|md|log|ya?ml|ini|conf|env|sh)$/i.test(name)) {
    const hits = findSecrets(Buffer.from(input.bytes.subarray(0, 2 * 1024 * 1024)).toString("utf-8"));
    if (hits.length) {
      throw new DomainError("invalid", `This file looks like it contains ${SECRET_KIND_LABELS[hits[0]?.kind ?? ""] ?? "a secret"}. Remove it before uploading.`);
    }
  }
  const sha = sha256Hex(input.bytes);
  return ctx.db.transaction((tx) => {
    let category = input.category;
    if (input.projectId !== null) {
      const p = loadProject(tx, input.projectId);
      assertProjectOpen(p);
      assertProjectMember(tx, p.id, actor);
      const cats = projectConfig(tx, p).file_categories.map((c) => c.code);
      if (!cats.includes(category)) category = "11_internal";
    }
    const storageKey = `${sha.slice(0, 2)}/${sha}`;
    const target = path.join(filesDir(), storageKey);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, input.bytes, { mode: 0o600 });
      fs.renameSync(tmp, target);
    }
    const id = tx
      .insert(files)
      .values({ projectId: input.projectId, category, name, mime, size: input.bytes.byteLength, sha256: sha, storageKey, uploadedBy: actor, uploadedAt: iso(ctx.now), visibility: input.visibility ?? "internal" })
      .returning({ id: files.id })
      .get().id;
    audit(tx, ctx, "file.upload", "file", id, input.projectId, undefined, { name, category, size: input.bytes.byteLength, sha256: sha });
    return { fileId: id, sha256: sha };
  });
}

export function fileRow(tx: DbOrTx, fileId: number) {
  const f = tx.select().from(files).where(eq(files.id, fileId)).get();
  if (!f) throw new DomainError("not_found", "File not found");
  return f;
}

/** Absolute path of a stored file, after checking it is inside the files folder and unchanged. */
export function storedFilePath(f: { storageKey: string; sha256: string }): string {
  const root = filesDir();
  const p = path.resolve(root, f.storageKey);
  if (!p.startsWith(root + path.sep)) throw new DomainError("forbidden", "Invalid file path");
  if (!fs.existsSync(p)) throw new DomainError("not_found", "The stored file is missing from disk");
  return p;
}

export function verifyStoredFile(f: { storageKey: string; sha256: string }): boolean {
  return sha256Hex(fs.readFileSync(storedFilePath(f))) === f.sha256;
}

export function updateFileRetention(ctx: Ctx, fileId: number, patch: { retentionUntil?: string | null; archived?: boolean; visibility?: "internal" | "client_shared" }) {
  const actor = requireActor(ctx);
  ctx.db.transaction((tx) => {
    const f = fileRow(tx, fileId);
    if (f.projectId !== null) assertProjectMember(tx, f.projectId, actor);
    const next = {
      retentionUntil: patch.retentionUntil !== undefined ? patch.retentionUntil : f.retentionUntil,
      archived: patch.archived ?? f.archived,
      visibility: patch.visibility ?? f.visibility,
    };
    tx.update(files).set(next).where(eq(files.id, fileId)).run();
    audit(tx, ctx, "file.update", "file", fileId, f.projectId, { retentionUntil: f.retentionUntil, archived: f.archived, visibility: f.visibility }, next);
  });
}
