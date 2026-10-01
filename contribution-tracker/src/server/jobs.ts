import { and, eq, inArray, lte } from "drizzle-orm";
import { disputes, taskInstances } from "@/db/schema";
import type { Ctx } from "./context";
import { iso } from "./context";
import { audit, loadProject } from "./common";
import { applyResolution } from "./disputes";

/**
 * Time-based rules, evaluated lazily (on each request, and on demand):
 *  - proposed tasks with no objection after auto_approve_hours become planned ("approved by silence");
 *  - disputes not resolved within dispute_default_resolution_days default to a 50/50 split, unless escalated.
 */
export function runDueJobs(ctx: Ctx): { autoApproved: number; disputesDefaulted: number } {
  const now = iso(ctx.now);
  let autoApproved = 0;
  let disputesDefaulted = 0;
  ctx.db.transaction((tx) => {
    const due = tx
      .select()
      .from(taskInstances)
      .where(and(eq(taskInstances.status, "proposed"), lte(taskInstances.autoApproveAt, now)))
      .all();
    for (const t of due) {
      const p = loadProject(tx, t.projectId);
      if (p.closeStatus === "closed_locked") continue;
      tx.update(taskInstances).set({ status: "planned", autoApproveAt: null, updatedAt: now }).where(eq(taskInstances.id, t.id)).run();
      audit(tx, { ...ctx, actorId: null }, "task.auto_approve", "task", t.id, t.projectId, { status: "proposed" }, { status: "planned", note: "approved by silence: no objection within the approval window" });
      autoApproved += 1;
    }
    const overdue = tx
      .select()
      .from(disputes)
      .where(and(inArray(disputes.status, ["open", "in_discussion"]), lte(disputes.defaultDueAt, now)))
      .all();
    for (const d of overdue) {
      const p = loadProject(tx, d.projectId);
      if (p.closeStatus === "closed_locked") continue;
      applyResolution(tx, { ...ctx, actorId: null }, d, "split_50_50", null, false, "Default after the resolution period passed without agreement");
      disputesDefaulted += 1;
    }
  });
  return { autoApproved, disputesDefaulted };
}

let lastRun = 0;

/** Runs the jobs at most once a minute per process; cheap enough to call on every request. */
export function runDueJobsThrottled(ctx: Ctx) {
  const t = ctx.now.getTime();
  if (t - lastRun < 60_000) return;
  lastRun = t;
  try {
    runDueJobs(ctx);
  } catch (e) {
    console.error("runDueJobs failed", e);
  }
}
