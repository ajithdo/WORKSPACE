"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { bool, optStr, str } from "@/lib/form";
import { updateHandoverItem } from "@/server/handover";

export async function updateHandoverAction(itemId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      updateHandoverItem(ctx, itemId, {
        status: str(fd, "status"),
        ownerConfirmed: str(fd, "owner_confirmed"),
        credentialsExist: bool(fd, "credentials_exist"),
        credentialsRotated: bool(fd, "credentials_rotated"),
        developerAccess: optStr(fd, "developer_access"),
        retainedReason: optStr(fd, "retained_reason"),
        notes: str(fd, "notes"),
      }),
    "Saved",
  );
}
