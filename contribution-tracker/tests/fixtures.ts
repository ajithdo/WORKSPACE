import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { taskContributions, taskInstances } from "@/db/schema";
import { setupStudio } from "@/server/auth";
import { addEvidence } from "@/server/evidence";
import { createProject, type CreateProjectInput } from "@/server/projects";
import { setClientApproval, startTask, submitTask, verifyTask } from "@/server/tasks";
import { ctxFor, T0, testDb } from "./helpers";

// Uploaded files go to a throwaway folder during tests.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ct-test-"));

export interface Fixture {
  db: AppDb;
  a: number;
  b: number;
  projectId: number;
  at: (actor: number | null, now?: Date) => ReturnType<typeof ctxFor>;
}

export function bootstrap(project: Partial<CreateProjectInput> = {}): Fixture {
  const db = testDb();
  const { memberIds } = setupStudio(db, T0, {
    studio: { name: "Two Partner Studio", stateCode: "36", gstRegistered: true, msmeRegistered: true },
    members: [
      { name: "Asha", email: "asha@studio.test", password: "correct horse battery", roles: ["FE", "Design", "Content"] },
      { name: "Bala", email: "bala@studio.test", password: "correct horse staple", roles: ["BE", "DevOps", "PM", "Sales", "QA"] },
    ],
  });
  const [a, b] = memberIds as [number, number];
  const { projectId } = createProject(ctxFor(db, a), {
    name: "Sunrise Bakery website",
    kind: "client",
    projectType: "brochure",
    newClient: { businessName: "Sunrise Bakery", stateCode: "36" },
    originatedBy: b,
    quotedAmountExGst: 6_000_000,
    ...project,
  });
  return { db, a, b, projectId, at: (actor, now = T0) => ctxFor(db, actor, now) };
}

export function taskByCode(f: Fixture, code: string) {
  const t = f.db
    .select()
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, f.projectId), eq(taskInstances.code, code)))
    .get();
  if (!t) throw new Error(`task ${code} not in plan`);
  return t;
}

export function contributorsOf(f: Fixture, taskId: number): number[] {
  return f.db
    .select({ m: taskContributions.memberId })
    .from(taskContributions)
    .where(eq(taskContributions.taskInstanceId, taskId))
    .all()
    .map((r) => r.m);
}

export function strongEvidence(f: Fixture, actor: number, taskId: number, now = T0) {
  return addEvidence(f.at(actor, now), {
    subjectType: "task",
    subjectId: taskId,
    type: "git_commit",
    externalRef: "4f2a9c1",
    description: "Commit implementing the task, linked to the task id",
    containsPersonalData: false,
    redacted: false,
    noSecretsConfirmed: true,
  });
}

/** Starts, evidences, submits and verifies a task as its first contributor, verified by the other partner. */
export function completeTask(f: Fixture, code: string, now = T0) {
  const t = taskByCode(f, code);
  const doer = contributorsOf(f, t.id)[0] as number;
  const verifier = doer === f.a ? f.b : f.a;
  if (t.status === "planned") startTask(f.at(doer, now), t.id);
  strongEvidence(f, doer, t.id, now);
  submitTask(f.at(doer, now), t.id);
  verifyTask(f.at(verifier, now), t.id);
  if (t.clientApproval === "Yes") {
    setClientApproval(f.at(doer, now), t.id, { status: "approved", approvedByName: "Client owner", approvedAt: now.toISOString(), channel: "email" });
  }
  return taskByCode(f, code);
}

export function openGate1(f: Fixture, now = T0) {
  completeTask(f, "H-05", now);
  completeTask(f, "I-02", now);
}
