"use server";

import { runAction, type ActionState } from "@/lib/actions";
import { optStr, str } from "@/lib/form";
import { acceptSuggestion, runCompletionCheck, runResearch, runSiteCheck, saveResearchAsEvidence, setSiteUrls } from "@/server/assistant";
import { addTasksFromLibrary, proposeCustomTask } from "@/server/plan";
import { DomainError } from "@/server/errors";

export async function siteUrlsAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => setSiteUrls(ctx, projectId, { local: str(fd, "local"), staging: str(fd, "staging"), live: str(fd, "live") }), "Addresses saved");
}
export async function siteCheckAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => runSiteCheck(ctx, projectId, optStr(fd, "url")), "Site checked");
}
export async function completionCheckAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => runCompletionCheck(ctx, projectId, { url: optStr(fd, "url"), notes: str(fd, "notes") }), "Claude reviewed the build");
}
export async function researchAction(projectId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => runResearch(ctx, projectId, { niche: str(fd, "niche"), location: str(fd, "location"), focus: str(fd, "focus") }), "Research ready");
}
export async function acceptAction(projectId: number, _p: ActionState, fd: FormData) {
  let message = "";
  const r = await runAction((ctx) => {
    if (fd.get("confirm") !== "on") throw new DomainError("invalid", "Confirm you checked the link yourself");
    message = acceptSuggestion(ctx, projectId, { code: str(fd, "code"), evidenceType: str(fd, "type"), url: optStr(fd, "url"), description: str(fd, "description") }).message;
  });
  return r?.ok ? { ...r, message } : r;
}
export async function addLibraryAction(projectId: number, code: string, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => addTasksFromLibrary(ctx, projectId, [code]), `${code} added to the plan`);
}
export async function addNewTaskAction(projectId: number, task: { name: string; categoryCode: string; points: number }, _p: ActionState, _fd: FormData) {
  return runAction((ctx) => proposeCustomTask(ctx, projectId, { name: task.name, categoryCode: task.categoryCode, defaultPoints: Math.max(1, Math.min(200, Math.round(task.points))) }), "Task added");
}
export async function saveBriefAction(reportId: number, _p: ActionState, fd: FormData) {
  return runAction((ctx) => saveResearchAsEvidence(ctx, reportId, str(fd, "task")), "Brief attached as evidence");
}
