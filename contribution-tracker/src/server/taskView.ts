import { and, desc, eq, inArray, or } from "drizzle-orm";
import { evidenceCheck, plannedPoints, verifierEligibility } from "@/domain/taskRules";
import type { AppDb } from "@/db";
import { adjustmentRequests, auditLog, clientApprovals, disputes, evidence, files, taskInstances, taskTemplates, timeEntries } from "@/db/schema";
import { addDays } from "./context";
import { contributionsOf, loadProject, loadTask, projectConfig, projectMemberIds } from "./common";
import { gateBlockForTask } from "./milestones";
import { canVerifyTask, evidenceForRound } from "./tasks";

export function taskDetail(db: AppDb, taskId: number, memberId: number, now: Date) {
  const t = loadTask(db, taskId);
  const p = loadProject(db, t.projectId);
  const cfg = projectConfig(db, p);
  const template = t.templateId ? db.select().from(taskTemplates).where(eq(taskTemplates.id, t.templateId)).get() : null;
  const shares = contributionsOf(db, t.id);
  const members = projectMemberIds(db, p.id);
  const ev = db
    .select({ e: evidence, f: files })
    .from(evidence)
    .leftJoin(files, eq(files.id, evidence.fileId))
    .where(and(eq(evidence.subjectType, "task"), eq(evidence.subjectId, t.id)))
    .all()
    .map((r) => ({ ...r.e, file: r.f }))
    .sort((a, b) => a.id - b.id);
  const approval = db.select().from(clientApprovals).where(eq(clientApprovals.taskInstanceId, t.id)).get() ?? null;
  const time = db.select().from(timeEntries).where(eq(timeEntries.taskInstanceId, t.id)).all();
  const adjustments = db.select().from(adjustmentRequests).where(eq(adjustmentRequests.taskInstanceId, t.id)).orderBy(desc(adjustmentRequests.id)).all();
  const evIds = ev.map((e) => e.id);
  const taskDisputes = db
    .select()
    .from(disputes)
    .where(
      or(
        and(eq(disputes.targetType, "task_instance"), eq(disputes.targetId, t.id)),
        evIds.length ? and(eq(disputes.targetType, "evidence"), inArray(disputes.targetId, evIds)) : undefined,
      ),
    )
    .all();
  const deps = t.dependsOn.length
    ? db
        .select({ id: taskInstances.id, code: taskInstances.code, name: taskInstances.name, status: taskInstances.status })
        .from(taskInstances)
        .where(and(eq(taskInstances.projectId, p.id), inArray(taskInstances.code, t.dependsOn)))
        .all()
    : [];
  const history = db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "task"), eq(auditLog.entityId, String(t.id))))
    .orderBy(desc(auditLog.id))
    .limit(30)
    .all();
  const contributorIds = shares.map((s) => s.memberId);
  const isContributor = contributorIds.includes(memberId);
  const gate = gateBlockForTask(db, p, t);
  const nextRound = t.status === "submitted" ? t.submissionRound : t.submissionRound + 1;
  const counted = evidenceForRound(db, t.id, nextRound);
  const planned = plannedPoints(t.defaultPoints, t.quantity, t.adjustmentFactor);
  const evidenceStatus = evidenceCheck(planned, counted, cfg.calculation.evidence_rule);
  const open = p.closeStatus !== "closed_locked";
  const eligibility = verifierEligibility(members, contributorIds, t.submittedBy ?? memberId);
  const activeDispute = taskDisputes.find((d) => d.status !== "resolved");
  const windowEnds = t.verifiedAt ? addDays(new Date(t.verifiedAt), cfg.calculation.dispute_window_days) : null;
  return {
    task: t,
    project: p,
    config: cfg,
    template,
    shares,
    members,
    evidence: ev,
    approval,
    time,
    minutesByMember: time.reduce<Record<number, number>>((acc, e) => ({ ...acc, [e.memberId]: (acc[e.memberId] ?? 0) + e.minutes }), {}),
    adjustments,
    disputes: taskDisputes,
    deps,
    history,
    gate,
    planned,
    evidenceStatus,
    eligibility,
    can: {
      start: open && t.status === "planned" && isContributor && !gate,
      block: open && t.status === "in_progress",
      unblock: open && t.status === "blocked",
      submit: open && t.status === "in_progress" && isContributor,
      verify: open && canVerifyTask(db, t, memberId),
      addEvidence: open && ["planned", "in_progress", "blocked", "submitted"].includes(t.status),
      editPlan: open && p.planStatus === "draft" && ["planned", "proposed", "in_progress", "blocked"].includes(t.status),
      adjust: open && p.planStatus === "locked" && !["locked", "cancelled", "proposed"].includes(t.status),
      dispute: open && t.status === "verified" && !activeDispute && !!windowEnds && now <= windowEnds,
      logTime: open && t.status !== "cancelled" && members.includes(memberId),
      clientApproval: open && t.clientApproval !== "No",
    },
    isContributor,
    windowEnds,
  };
}
