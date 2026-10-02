import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, evidence } from "@/db/schema";
import { addEvidence, reviewEvidence } from "@/server/evidence";
import { runDueJobs } from "@/server/jobs";
import { approvePlan, approveProposal, proposeCustomTask, submitPlan, updatePlannedTask } from "@/server/plan";
import { rejectSubmission, startTask, submitTask, verifyTask } from "@/server/tasks";
import { bootstrap, completeTask, openGate1, strongEvidence, taskByCode } from "../fixtures";
import { T0 } from "../helpers";

const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

function mediumEvidence(f: ReturnType<typeof bootstrap>, actor: number, taskId: number, now = T0) {
  return addEvidence(f.at(actor, now), {
    subjectType: "task",
    subjectId: taskId,
    type: "document_link",
    url: "https://docs.example.com/d/abc",
    description: "Shared document with the deliverable and history",
    containsPersonalData: false,
    redacted: false,
    noSecretsConfirmed: true,
  });
}

describe("verification rules", () => {
  it("A cannot verify a task where A is a contributor", () => {
    const f = bootstrap();
    openGate1(f);
    const t = taskByCode(f, "V-09");
    startTask(f.at(f.a), t.id);
    strongEvidence(f, f.a, t.id);
    submitTask(f.at(f.a), t.id);
    expect(() => verifyTask(f.at(f.a), t.id)).toThrow(/cannot verify/);
    verifyTask(f.at(f.b), t.id);
    expect(taskByCode(f, "V-09").status).toBe("verified");
    expect(taskByCode(f, "V-09").verifiedBy).toBe(f.b);
  });

  it("joint verification when every member contributed", () => {
    const f = bootstrap();
    const t = taskByCode(f, "J-08");
    startTask(f.at(f.a), t.id);
    mediumEvidence(f, f.a, t.id);
    submitTask(f.at(f.a), t.id);
    expect(() => verifyTask(f.at(f.a), t.id)).toThrow(/cannot verify/);
    expect(verifyTask(f.at(f.b), t.id).status).toBe("verified");
  });

  it("only contributors can start or submit", () => {
    const f = bootstrap();
    openGate1(f);
    const t = taskByCode(f, "V-09");
    expect(() => startTask(f.at(f.b), t.id)).toThrow(/contributor/);
  });
});

describe("submission rules", () => {
  it("submit blocked without sufficient evidence", () => {
    const f = bootstrap();
    openGate1(f);
    const t = taskByCode(f, "V-09");
    startTask(f.at(f.a), t.id);
    expect(() => submitTask(f.at(f.a), t.id)).toThrow(/evidence/);
    mediumEvidence(f, f.a, t.id);
    expect(() => submitTask(f.at(f.a), t.id)).toThrow(/strong/);
  });

  it("start blocked by gate 1", () => {
    const f = bootstrap();
    expect(() => startTask(f.at(f.a), taskByCode(f, "S-01").id)).toThrow(/Gate 1/);
  });

  it("soft dependencies only warn", () => {
    const f = bootstrap();
    const { warnings } = startTask(f.at(f.b), taskByCode(f, "D-02").id);
    expect(warnings.join(" ")).toMatch(/D-01/);
  });

  it("evidence after submit belongs to next round", () => {
    const f = bootstrap();
    const t = taskByCode(f, "D-02");
    startTask(f.at(f.b), t.id);
    const e1 = mediumEvidence(f, f.b, t.id);
    submitTask(f.at(f.b), t.id);
    const e2 = mediumEvidence(f, f.b, t.id);
    const rows = f.db.select().from(evidence).where(eq(evidence.subjectId, t.id)).all();
    expect(rows.find((r) => r.id === e1.evidenceId)?.submissionRound).toBe(1);
    expect(rows.find((r) => r.id === e2.evidenceId)?.submissionRound).toBe(2);
    reviewEvidence(f.at(f.a), e1.evidenceId, { status: "rejected", reason: "Link is private" });
    rejectSubmission(f.at(f.a), t.id, "Evidence link is not accessible");
    expect(taskByCode(f, "D-02").status).toBe("in_progress");
    submitTask(f.at(f.b), t.id);
    expect(taskByCode(f, "D-02").submissionRound).toBe(2);
    verifyTask(f.at(f.a), t.id);
    expect(taskByCode(f, "D-02").status).toBe("verified");
  });

  it("refuses evidence that contains a secret", () => {
    const f = bootstrap();
    const t = taskByCode(f, "D-02");
    expect(() =>
      addEvidence(f.at(f.b), {
        subjectType: "task",
        subjectId: t.id,
        type: "config_record",
        description: "Staging DB at https://admin:hunter2@db.example.com",
        containsPersonalData: false,
        redacted: false,
        noSecretsConfirmed: true,
      }),
    ).toThrow(/password inside a URL/);
  });

  it("requires the no-secrets confirmation and redaction of personal data", () => {
    const f = bootstrap();
    const t = taskByCode(f, "D-02");
    const base = { subjectType: "task" as const, subjectId: t.id, type: "screenshot", description: "Screenshot of the form submissions", containsPersonalData: false, redacted: false, noSecretsConfirmed: true };
    expect(() => addEvidence(f.at(f.b), { ...base, noSecretsConfirmed: false })).toThrow(/confirm/);
    expect(() => addEvidence(f.at(f.b), { ...base, containsPersonalData: true })).toThrow(/redact/);
    expect(() => addEvidence(f.at(f.b), { ...base, description: "short" })).toThrow(/10/);
  });

  it("verified task's shares are frozen even in a draft plan", () => {
    const f = bootstrap();
    const done = completeTask(f, "D-02");
    expect(() => updatePlannedTask(f.at(f.b), done.id, { sharesBp: { [f.a]: 5000, [f.b]: 5000 } })).toThrow(/already been submitted/);
  });
});

describe("proposed tasks", () => {
  function locked() {
    const f = bootstrap();
    submitPlan(f.at(f.a), f.projectId);
    approvePlan(f.at(f.b), f.projectId);
    return f;
  }

  it("proposed task auto-approves after 72h (approved by silence)", () => {
    const f = locked();
    const { taskId } = proposeCustomTask(f.at(f.a), f.projectId, { name: "Extra landing page", categoryCode: "V", defaultPoints: 4 });
    runDueJobs(f.at(null, hours(71)));
    expect(taskByCode(f, "V-X01").status).toBe("proposed");
    const r = runDueJobs(f.at(null, hours(73)));
    expect(r.autoApproved).toBe(1);
    expect(taskByCode(f, "V-X01").status).toBe("planned");
    const log = f.db.select().from(auditLog).where(and(eq(auditLog.action, "task.auto_approve"), eq(auditLog.entityId, String(taskId)))).get();
    expect(log?.actorLabel).toBe("system");
    expect(log?.after).toMatch(/approved by silence/);
  });

  it("the proposer cannot approve their own proposal", () => {
    const f = locked();
    const { taskId } = proposeCustomTask(f.at(f.a), f.projectId, { name: "Extra landing page", categoryCode: "V", defaultPoints: 4 });
    expect(() => approveProposal(f.at(f.a), taskId)).toThrow(/other partner/);
    approveProposal(f.at(f.b), taskId);
    expect(taskByCode(f, "V-X01").status).toBe("planned");
  });
});
