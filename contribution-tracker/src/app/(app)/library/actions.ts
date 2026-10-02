"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { int, str } from "@/lib/form";
import { createDraftLibraryVersion, decideLibraryVersion, submitLibraryVersion, updateDraftTemplate } from "@/server/versions";

export async function newDraftAction(_p: ActionState, fd: FormData) {
  return runAction((ctx) => createDraftLibraryVersion(ctx, str(fd, "note")), "Draft created — edit tasks below");
}
export async function editTemplateAction(templateId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) => updateDraftTemplate(ctx, templateId, { name: str(fd, "name"), defaultPoints: int(fd, "points", "Points"), effortRange: str(fd, "effort"), complexity: str(fd, "complexity") }),
    "Saved in the draft",
  );
}
export async function submitDraftAction(versionId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => submitLibraryVersion(ctx, versionId), "Sent to your partner");
}
export async function decideAction(versionId: number, decision: "approve" | "reject", _p: ActionState, fd: FormData) {
  return runAction((ctx) => decideLibraryVersion(ctx, versionId, decision, str(fd, "note")), decision === "approve" ? "Approved" : "Sent back to draft");
}
