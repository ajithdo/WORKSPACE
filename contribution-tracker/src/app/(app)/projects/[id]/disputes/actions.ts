"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { num, sharesFrom, str } from "@/lib/form";
import { acceptResolution, commentOnDispute, escalateDispute, proposeResolution, raiseDispute, type DisputeTarget } from "@/server/disputes";

export async function raiseDisputeAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const [type, id] = str(fd, "target").split(":");
    raiseDispute(ctx, { projectId, targetType: type as DisputeTarget, targetId: Number(id), reasonCode: str(fd, "reason_code"), description: str(fd, "description") });
  }, "Dispute raised");
}
export async function commentAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => commentOnDispute(ctx, id, str(fd, "body")), "Comment added");
}
export async function proposeAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const resolution = str(fd, "resolution");
    const payload = resolution === "change_shares" ? { sharesBp: sharesFrom(fd) } : resolution === "change_adjustment" ? { factor: num(fd, "factor", "Factor") } : null;
    proposeResolution(ctx, id, { resolution, payload, note: str(fd, "note") });
  }, "Proposal sent");
}
export async function acceptAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => acceptResolution(ctx, id), "Resolved by both partners");
}
export async function escalateAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => escalateDispute(ctx, id, str(fd, "note")), "Escalated: the automatic 50/50 default is stopped");
}
