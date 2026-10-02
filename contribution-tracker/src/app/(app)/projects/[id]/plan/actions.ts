"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { int, num, optNum, sharesFrom, str } from "@/lib/form";
import { DomainError } from "@/server/errors";
import {
  addTasksFromLibrary,
  approvePlan,
  approveProposal,
  proposeCustomTask,
  rejectPlan,
  rejectProposal,
  removePlannedTask,
  submitPlan,
  updatePlannedTask,
  withdrawPlan,
} from "@/server/plan";
import { repinProject } from "@/server/versions";

export async function submitPlanAction(projectId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => submitPlan(ctx, projectId), "Plan sent to your partner for approval");
}
export async function approvePlanAction(projectId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => approvePlan(ctx, projectId), "Approved");
}
export async function rejectPlanAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => rejectPlan(ctx, projectId, str(fd, "reason")), "Sent back to draft");
}
export async function withdrawPlanAction(projectId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => withdrawPlan(ctx, projectId), "Withdrawn — the plan is a draft again");
}
export async function setOwnerAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const owner = int(fd, "owner", "Owner");
    updatePlannedTask(ctx, taskId, { ownerMemberId: owner, sharesBp: { [owner]: 10000 } });
  }, "Owner changed");
}
export async function updatePlanTaskAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const shares = sharesFrom(fd);
    const owner = optNum(fd, "owner", "Owner");
    updatePlannedTask(ctx, taskId, {
      quantity: num(fd, "quantity", "Quantity"),
      adjustmentFactor: num(fd, "factor", "Adjustment factor"),
      sharesBp: Object.keys(shares).length ? shares : undefined,
      ownerMemberId: owner ?? undefined,
      ownDefect: fd.get("own_defect") === "on",
      notes: str(fd, "notes"),
    });
  }, "Plan updated");
}
export async function removeTaskAction(taskId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => removePlannedTask(ctx, taskId), "Removed from the plan");
}
export async function addLibraryTasksAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => {
    const codes = str(fd, "codes")
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
      .map((c) => c.split(" ")[0] as string);
    if (!codes.length) throw new DomainError("invalid", "Type or pick a task code, like V-13");
    addTasksFromLibrary(ctx, projectId, codes);
  }, "Added");
}
export async function addCustomTaskAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction(
    (ctx) =>
      proposeCustomTask(ctx, projectId, {
        name: str(fd, "name"),
        categoryCode: str(fd, "category"),
        defaultPoints: num(fd, "points", "Points"),
        description: str(fd, "description"),
        ownerMemberId: int(fd, "owner", "Owner"),
      }),
    "Added",
  );
}
export async function approveProposalAction(taskId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => approveProposal(ctx, taskId), "Approved");
}
export async function rejectProposalAction(taskId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => rejectProposal(ctx, taskId, str(fd, "reason") || "Not needed"), "Rejected");
}
export async function repinRulesAction(projectId: number, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => repinProject(ctx, projectId), "Project now uses the latest rules");
}
