import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db";
import { projectMembers, projects, taskContributions, taskInstances } from "@/db/schema";
import { gateBlockFor } from "@/domain/gates";
import { PHASES, type Phase } from "@/domain/types";
import { projectConfig } from "./common";
import { projectMilestones } from "./milestones";

export interface MyTask {
  id: number;
  projectId: number;
  projectName: string;
  code: string;
  name: string;
  points: number;
  status: string;
  note: string;
}

export interface MyWork {
  sentBack: MyTask[];
  inProgress: MyTask[];
  blocked: MyTask[];
  ready: MyTask[];
  waitingOnGate: MyTask[];
}

/** The member's own open work across projects, grouped by what to do next. */
export function myWork(db: AppDb, memberId: number): MyWork {
  const open = db
    .select({ p: projects })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, memberId), eq(projectMembers.active, true)))
    .where(eq(projects.closeStatus, "open"))
    .all()
    .map((r) => r.p);
  const out: MyWork = { sentBack: [], inProgress: [], blocked: [], ready: [], waitingOnGate: [] };
  if (!open.length) return out;
  const mine = new Set(
    db
      .select({ id: taskContributions.taskInstanceId })
      .from(taskContributions)
      .innerJoin(taskInstances, eq(taskInstances.id, taskContributions.taskInstanceId))
      .where(and(eq(taskContributions.memberId, memberId), inArray(taskInstances.projectId, open.map((p) => p.id))))
      .all()
      .map((r) => r.id),
  );
  const phaseOrder = (ph: string) => PHASES.indexOf(ph as Phase);
  for (const p of open) {
    const states = p.kind === "client" ? projectMilestones(db, p) : [];
    const configs = projectConfig(db, p).milestones;
    const tasks = db
      .select()
      .from(taskInstances)
      .where(and(eq(taskInstances.projectId, p.id), inArray(taskInstances.status, ["planned", "in_progress", "blocked"])))
      .all()
      .filter((t) => mine.has(t.id))
      .sort((a, b) => phaseOrder(a.phase) - phaseOrder(b.phase) || a.code.localeCompare(b.code));
    for (const t of tasks) {
      const item: MyTask = { id: t.id, projectId: p.id, projectName: `${p.code} · ${p.name}`, code: t.code, name: t.name, points: t.defaultPoints * t.quantity * t.adjustmentFactor, status: t.status, note: "" };
      if (t.status === "in_progress" && t.rejectionReason) out.sentBack.push({ ...item, note: t.rejectionReason });
      else if (t.status === "in_progress") out.inProgress.push(item);
      else if (t.status === "blocked") out.blocked.push({ ...item, note: t.blockedReason ?? "" });
      else {
        const gate = p.kind === "client" ? gateBlockFor({ code: t.code, phase: t.phase as Phase, categoryCode: t.categoryCode }, configs, states) : null;
        if (gate) out.waitingOnGate.push({ ...item, note: `${gate.milestoneName}: waiting on ${gate.missing.join(", ")}` });
        else out.ready.push(item);
      }
    }
  }
  return out;
}
