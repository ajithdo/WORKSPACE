"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { bool, optStr, str } from "@/lib/form";
import { DomainError } from "@/server/errors";
import { storeFile, updateFileRetention } from "@/server/files";

export async function uploadFileAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction(async (ctx) => {
    if (!bool(fd, "no_secrets")) throw new DomainError("invalid", "Confirm the file has no passwords, keys or unredacted customer data");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("invalid", "Choose a file");
    const { fileId } = storeFile(ctx, {
      projectId,
      category: str(fd, "category"),
      name: file.name,
      mime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      visibility: str(fd, "visibility") === "client_shared" ? "client_shared" : "internal",
    });
    const until = optStr(fd, "retention_until");
    if (until) updateFileRetention(ctx, fileId, { retentionUntil: until });
  }, "Uploaded");
}

export async function retentionAction(fileId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => updateFileRetention(ctx, fileId, { retentionUntil: optStr(fd, "retention_until"), archived: bool(fd, "archived") }), "Saved");
}
