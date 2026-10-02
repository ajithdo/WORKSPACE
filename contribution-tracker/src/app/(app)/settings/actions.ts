"use server";

import { OWNER_ROLES } from "@/domain/types";
import { cookies } from "next/headers";
import { runAction, type ActionState } from "@/lib/actions";
import { SESSION_COOKIE } from "@/lib/session";
import { bool, num, str } from "@/lib/form";
import { addMember, changePassword, signOutOtherSessions, updateMember } from "@/server/auth";
import { decideReserveEntry } from "@/server/finance";
import { updateStudio } from "@/server/settings";
import { createDraftConfig, decideConfig, submitConfig, updateDraftConfig } from "@/server/versions";

const rolesFrom = (fd: FormData) => OWNER_ROLES.filter((r) => fd.get(`role_${r}`) === "on");

export async function updateStudioAction(_p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      updateStudio(ctx, {
        name: str(fd, "name"),
        legalName: str(fd, "legal_name"),
        gstin: str(fd, "gstin"),
        stateCode: str(fd, "state_code"),
        gstRegistered: bool(fd, "gst_registered"),
        msmeRegistered: bool(fd, "msme_registered"),
        udyamNumber: str(fd, "udyam"),
        address: str(fd, "address"),
        invoicePrefix: str(fd, "invoice_prefix"),
      }),
    "Studio details saved",
  );
}
export async function addMemberAction(_p: ActionState, fd: FormData) {
  return runAction((ctx) => addMember(ctx, { name: str(fd, "name"), email: str(fd, "email"), password: String(fd.get("password") ?? ""), roles: rolesFrom(fd) }), "Member added");
}
export async function updateMemberAction(memberId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => updateMember(ctx, memberId, { name: str(fd, "name"), roles: rolesFrom(fd), active: bool(fd, "active") }), "Saved");
}
export async function changePasswordAction(_p: ActionState, fd: FormData) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return runAction((ctx) => {
    changePassword(ctx, { current: String(fd.get("current") ?? ""), next: String(fd.get("next") ?? "") });
    signOutOtherSessions(ctx.db, ctx.actorId!, token);
  }, "Password changed. Your other devices are signed out.");
}
export async function signOutOthersAction(_p: ActionState) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return runAction((ctx) => {
    signOutOtherSessions(ctx.db, ctx.actorId!, token);
  }, "Signed out everywhere else");
}
export async function newRulesDraftAction(_p: ActionState, fd: FormData) {
  return runAction((ctx) => createDraftConfig(ctx, str(fd, "note")), "Draft created");
}
const PCT_FIELDS = ["reserve_pct", "base_share_pct", "pool_pct", "communication_cap_pct", "sales_cap_pct", "micro_task_cap_pct", "origination_credit_pct", "calibration_flag_pct"] as const;
const NUM_FIELDS = ["adjustment_min", "adjustment_max", "own_defect_fix_points", "auto_approve_hours", "dispute_window_days", "dispute_default_resolution_days", "effort_adjustment_trigger_multiple", "micro_task_points_threshold", "msme_payment_days", "dispute_retro_threshold"] as const;

export async function editRulesAction(versionId: number, commCodes: string[], _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const calculation: Record<string, unknown> = {};
    for (const f of PCT_FIELDS) calculation[f] = num(fd, f, f.replaceAll("_", " ")) / 100;
    for (const f of NUM_FIELDS) calculation[f] = num(fd, f, f.replaceAll("_", " "));
    calculation.distribute_tds_credit = bool(fd, "distribute_tds_credit");
    calculation.dispute_default_split_mode = str(fd, "dispute_default_split_mode");
    const communicationPoints: Record<string, { lead_points: number; second_attendee_points: number }> = {};
    for (const c of commCodes) communicationPoints[c] = { lead_points: num(fd, `lead_${c}`, "Lead points"), second_attendee_points: num(fd, `second_${c}`, "Second attendee points") };
    updateDraftConfig(ctx, versionId, { calculation, communicationPoints });
  }, "Draft rules saved");
}
export async function submitRulesAction(versionId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => submitConfig(ctx, versionId), "Sent to your partner");
}
export async function decideRulesAction(versionId: number, decision: "approve" | "reject", _p: ActionState, fd: FormData) {
  return runAction((ctx) => decideConfig(ctx, versionId, decision, str(fd, "note")), decision === "approve" ? "Approved" : "Sent back");
}
export async function decideReserveAction(entryId: number, decision: "approved" | "rejected", _p: ActionState, _fd: FormData) {
  return runAction((ctx) => decideReserveEntry(ctx, entryId, decision), decision === "approved" ? "Released" : "Rejected");
}

