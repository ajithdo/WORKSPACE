/**
 * Fills an EMPTY data folder with a demo studio so the app can be explored.
 * Usage: DATA_DIR=./demo-data npm run seed:demo
 * Sign in as asha@studio.test / "demo password one" or bala@studio.test / "demo password two".
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { taskContributions, taskInstances } from "@/db/schema";
import { isSetUp, setupStudio } from "@/server/auth";
import type { Ctx } from "@/server/context";
import { addEvidence } from "@/server/evidence";
import { approvePlan, submitPlan } from "@/server/plan";
import { createProject } from "@/server/projects";
import { startTask, submitTask, verifyTask } from "@/server/tasks";

const db = getDb();
if (isSetUp(db)) {
  console.error("This data folder already has a studio. Point DATA_DIR at an empty folder for the demo.");
  process.exit(1);
}
const ctx = (actorId: number): Ctx => ({ db, actorId, now: new Date() });

const { memberIds } = setupStudio(db, new Date(), {
  studio: { name: "Demo Studio", stateCode: "36", gstRegistered: true, msmeRegistered: true },
  members: [
    { name: "Asha Rao", email: "asha@studio.test", password: "demo password one", roles: ["FE", "Design", "Content"] },
    { name: "Bala Kumar", email: "bala@studio.test", password: "demo password two", roles: ["BE", "DevOps", "PM", "Sales", "QA"] },
  ],
});
const [a, b] = memberIds as [number, number];

const { projectId } = createProject(ctx(a), {
  name: "Sunrise Bakery website",
  kind: "client",
  projectType: "brochure",
  newClient: { businessName: "Sunrise Bakery", stateCode: "36" },
  originatedBy: b,
  quotedAmountExGst: 6_000_000,
});

function complete(code: string) {
  const t = db.select().from(taskInstances).where(and(eq(taskInstances.projectId, projectId), eq(taskInstances.code, code))).get();
  if (!t) return;
  const doer = db.select().from(taskContributions).where(eq(taskContributions.taskInstanceId, t.id)).get()?.memberId ?? a;
  const verifier = doer === a ? b : a;
  startTask(ctx(doer), t.id);
  addEvidence(ctx(doer), {
    subjectType: "task",
    subjectId: t.id,
    type: "git_commit",
    externalRef: "4f2a9c1",
    description: `Demo evidence for ${code}`,
    containsPersonalData: false,
    redacted: false,
    noSecretsConfirmed: true,
  });
  submitTask(ctx(doer), t.id);
  verifyTask(ctx(verifier), t.id);
}

for (const code of ["H-05", "I-02"]) complete(code);
submitPlan(ctx(a), projectId);
approvePlan(ctx(b), projectId);
console.log(`Demo studio ready: project ${projectId}, plan locked, gate 1 open.`);
