import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db";
import { clients, members, projectMembers, projects, taskInstances } from "@/db/schema";
import { loadProject, projectConfig, projectMemberIds } from "./common";
import { projectMilestones } from "./milestones";

export function memberNames(db: AppDb): Map<number, string> {
  return new Map(
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .all()
      .map((m) => [m.id, m.name]),
  );
}

export function projectList(db: AppDb) {
  const rows = db.select().from(projects).orderBy(desc(projects.id)).all();
  const clientNames = new Map(
    db
      .select({ id: clients.id, name: clients.businessName })
      .from(clients)
      .all()
      .map((c) => [c.id, c.name]),
  );
  const tasks = rows.length
    ? db
        .select({ projectId: taskInstances.projectId, status: taskInstances.status })
        .from(taskInstances)
        .where(
          inArray(
            taskInstances.projectId,
            rows.map((r) => r.id),
          ),
        )
        .all()
    : [];
  return rows.map((p) => {
    const mine = tasks.filter((t) => t.projectId === p.id && t.status !== "cancelled");
    const done = mine.filter((t) => t.status === "verified" || t.status === "locked").length;
    const milestones = p.kind === "client" ? projectMilestones(db, p) : [];
    const nextMilestone = milestones.find((m) => m.state === "pending");
    return {
      ...p,
      clientName: p.clientId ? (clientNames.get(p.clientId) ?? "") : "",
      taskTotal: mine.length,
      taskDone: done,
      waitingCheck: mine.filter((t) => t.status === "submitted").length,
      milestonesDone: milestones.filter((m) => m.state !== "pending").length,
      milestonesTotal: milestones.length,
      nextMilestone: nextMilestone ? { name: nextMilestone.name, hardGate: nextMilestone.hardGate } : null,
    };
  });
}

export function projectHeader(db: AppDb, projectId: number) {
  const p = loadProject(db, projectId);
  const client = p.clientId ? db.select().from(clients).where(eq(clients.id, p.clientId)).get() : null;
  const ids = projectMemberIds(db, projectId);
  const names = memberNames(db);
  return { project: p, client, members: ids.map((id) => ({ id, name: names.get(id) ?? `#${id}` })), config: projectConfig(db, p) };
}

export function isProjectMember(db: AppDb, projectId: number, memberId: number) {
  return !!db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.memberId, memberId), eq(projectMembers.active, true)))
    .get();
}

import { approvalVotes, categoryTemplates, taskContributions, taskTemplates } from "@/db/schema";
import { PHASES } from "@/domain/types";

export function planView(db: AppDb, projectId: number) {
  const p = loadProject(db, projectId);
  const tasks = db.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const contribs = tasks.length
    ? db
        .select()
        .from(taskContributions)
        .where(
          inArray(
            taskContributions.taskInstanceId,
            tasks.map((t) => t.id),
          ),
        )
        .all()
    : [];
  const byTask = new Map<number, { memberId: number; shareBp: number }[]>();
  for (const c of contribs) byTask.set(c.taskInstanceId, [...(byTask.get(c.taskInstanceId) ?? []), { memberId: c.memberId, shareBp: c.shareBp }]);
  const rows = tasks
    .map((t) => ({ ...t, points: t.defaultPoints * t.quantity * t.adjustmentFactor, shares: byTask.get(t.id) ?? [] }))
    .sort((a, b) => PHASES.indexOf(a.phase as (typeof PHASES)[number]) - PHASES.indexOf(b.phase as (typeof PHASES)[number]) || a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const memberIds = projectMemberIds(db, projectId);
  const perMember = new Map(memberIds.map((m) => [m, 0]));
  for (const r of rows) {
    if (r.status === "cancelled" || r.status === "proposed") continue;
    for (const s of r.shares) perMember.set(s.memberId, (perMember.get(s.memberId) ?? 0) + (r.points * s.shareBp) / 10000);
  }
  const votes = db
    .select()
    .from(approvalVotes)
    .where(and(eq(approvalVotes.subjectType, "plan"), eq(approvalVotes.subjectId, projectId), eq(approvalVotes.round, p.planRound)))
    .all();
  const categories = db.select().from(categoryTemplates).where(eq(categoryTemplates.libraryVersionId, p.libraryVersionId)).all();
  const inPlan = new Set(tasks.map((t) => t.code.split("#")[0]));
  const available = db
    .select({ code: taskTemplates.code, name: taskTemplates.name, points: taskTemplates.defaultPoints, classification: taskTemplates.classification, sortOrder: taskTemplates.sortOrder })
    .from(taskTemplates)
    .where(eq(taskTemplates.libraryVersionId, p.libraryVersionId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { project: p, rows, perMember, votes, categories, available, inPlan };
}
