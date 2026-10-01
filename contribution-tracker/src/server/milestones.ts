import { and, eq } from "drizzle-orm";
import { evaluateMilestones, gateBlockFor, type GateTaskState, type MilestoneState } from "@/domain/gates";
import type { Phase } from "@/domain/types";
import type { DbOrTx } from "@/db";
import { clientApprovals, contributionSnapshots, taskInstances } from "@/db/schema";
import { projectConfig, type ProjectRow, type TaskRow } from "./common";
import { handoverStatus } from "./handover";

export function gateTaskStates(tx: DbOrTx, projectId: number): GateTaskState[] {
  const tasks = tx.select().from(taskInstances).where(eq(taskInstances.projectId, projectId)).all();
  const approvals = new Map(
    tx
      .select()
      .from(clientApprovals)
      .innerJoin(taskInstances, eq(taskInstances.id, clientApprovals.taskInstanceId))
      .where(eq(taskInstances.projectId, projectId))
      .all()
      .map((r) => [r.client_approvals.taskInstanceId, r.client_approvals]),
  );
  return tasks.map((t) => {
    const a = approvals.get(t.id);
    const times = [t.verifiedAt, a?.approvedAt].filter((x): x is string => !!x).sort();
    return {
      code: t.code,
      status: t.status as GateTaskState["status"],
      clientApproval: t.clientApproval as GateTaskState["clientApproval"],
      clientApprovalStatus: (a?.status ?? null) as GateTaskState["clientApprovalStatus"],
      doneAt: times.at(-1) ?? null,
    };
  });
}

export function projectMilestones(tx: DbOrTx, p: ProjectRow): MilestoneState[] {
  const cfg = projectConfig(tx, p);
  const snapshotLocked = !!tx
    .select({ id: contributionSnapshots.id })
    .from(contributionSnapshots)
    .where(and(eq(contributionSnapshots.projectId, p.id), eq(contributionSnapshots.status, "locked")))
    .get();
  const handover = p.kind === "client" ? handoverStatus(tx, p.id) : null;
  return evaluateMilestones(cfg.milestones, gateTaskStates(tx, p.id), {
    M3: { ok: p.planStatus === "locked", label: "Plan locked by both partners" },
    M10: { ok: handover?.complete ?? true, label: "Handover checklist complete" },
    M11: { ok: snapshotLocked, label: "Contribution snapshot locked" },
  });
}

/** Hard gates apply to client projects only. */
export function gateBlockForTask(tx: DbOrTx, p: ProjectRow, t: TaskRow) {
  if (p.kind !== "client") return null;
  const cfg = projectConfig(tx, p);
  return gateBlockFor({ code: t.code, phase: t.phase as Phase, categoryCode: t.categoryCode }, cfg.milestones, projectMilestones(tx, p));
}
