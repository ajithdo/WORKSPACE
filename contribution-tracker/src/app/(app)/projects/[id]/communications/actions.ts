"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { bool, int, istLocalToIso, lines, optInt, optStr, str } from "@/lib/form";
import { cancelCommunication, logCommunication, planCommunication, rejectCommunication, verifyCommunication } from "@/server/communications";
import { addEvidenceFor } from "@/lib/evidence-action";

const toIso = (local: string) => (local ? istLocalToIso(local) : new Date().toISOString());

export async function planCommunicationAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      planCommunication(ctx, projectId, {
        type: str(fd, "type"),
        scheduledFor: toIso(str(fd, "scheduled_for")),
        leadMemberId: int(fd, "lead", "Lead"),
        secondMemberId: optInt(fd, "second", "Second attendee"),
        secondRequired: bool(fd, "second_required"),
        channel: optStr(fd, "channel"),
      }),
    "Planned",
  );
}

function actionItems(fd: FormData) {
  const category = str(fd, "action_category") || "K";
  return lines(fd, "action_items").map((text) => ({ text, categoryCode: category, points: 1, ownerMemberId: optInt(fd, "action_owner", "Owner") }));
}

export async function logCommunicationAction(projectId: number, communicationId: number | null, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      logCommunication(ctx, {
        communicationId: communicationId ?? undefined,
        projectId,
        type: str(fd, "type"),
        occurredAt: toIso(str(fd, "occurred_at")),
        channel: str(fd, "channel"),
        durationMinutes: optInt(fd, "duration", "Duration"),
        leadMemberId: optInt(fd, "lead", "Lead") ?? undefined,
        secondMemberId: optInt(fd, "second", "Second attendee"),
        clientAttendees: str(fd, "client_attendees"),
        summary: str(fd, "summary"),
        decisions: lines(fd, "decisions"),
        actionItems: actionItems(fd),
        notesSentToClient: bool(fd, "notes_sent"),
      }),
    "Logged. Add the notes you sent, then your partner verifies it.",
  );
}

export async function verifyCommunicationAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => verifyCommunication(ctx, id), "Verified");
}
export async function rejectCommunicationAction(id: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => rejectCommunication(ctx, id, str(fd, "reason")), "Rejected");
}
export async function cancelCommunicationAction(id: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => cancelCommunication(ctx, id), "Cancelled");
}
export async function addCommunicationEvidenceAction(id: number, projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => addEvidenceFor(ctx, "communication", id, projectId, fd), "Evidence added");
}
