import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { categoryTemplates, configVersions, projects, taskInstances, taskTemplates } from "@/db/schema";
import { appendAudit, verifyAuditChain } from "@/server/audit";
import { importSeedLibrary } from "@/server/seedImport";
import { addMembers, ctxFor, T0, testDb } from "../helpers";

function setup() {
  const db = testDb();
  const [a] = addMembers(db);
  const ids = importSeedLibrary(ctxFor(db, a ?? null));
  return { db, a: a as number, ...ids };
}

function insertProject(db: ReturnType<typeof testDb>, libraryVersionId: number, configVersionId: number, closeStatus: "open" | "closed_locked" = "open") {
  const now = T0.toISOString();
  return db
    .insert(projects)
    .values({ code: `P-${Math.random()}`, name: "Test", kind: "client", projectType: "brochure", libraryVersionId, configVersionId, planStatus: "draft", closeStatus, paymentSchedule: [], createdAt: now, updatedAt: now })
    .returning({ id: projects.id })
    .get().id;
}

function insertTask(db: ReturnType<typeof testDb>, projectId: number, code: string, status = "planned") {
  const now = T0.toISOString();
  return db
    .insert(taskInstances)
    .values({ projectId, code, categoryCode: "V", name: code, phase: "development", dependsOn: [], defaultPoints: 1, status, createdAt: now, updatedAt: now })
    .returning({ id: taskInstances.id })
    .get().id;
}

describe("seed import", () => {
  it("seed import creates 67 categories and 343 templates", () => {
    const { db, libraryVersionId } = setup();
    expect(db.select().from(categoryTemplates).where(eq(categoryTemplates.libraryVersionId, libraryVersionId)).all()).toHaveLength(67);
    expect(db.select().from(taskTemplates).where(eq(taskTemplates.libraryVersionId, libraryVersionId)).all()).toHaveLength(343);
    const cfg = db.select().from(configVersions).get();
    expect(cfg?.status).toBe("active");
    expect(cfg?.data.task_transitions).toContainEqual(["in_progress", "cancelled"]);
    expect(verifyAuditChain(db)).toEqual({ ok: true, count: 1 });
  });

  it("refuses to import twice", () => {
    const { db, a } = setup();
    expect(() => importSeedLibrary(ctxFor(db, a))).toThrow(/already been imported/);
  });
});

describe("immutability triggers", () => {
  it("audit_log rejects UPDATE and DELETE", () => {
    const { db } = setup();
    expect(() => db.$client.exec("UPDATE audit_log SET action = 'x'")).toThrow(/append-only/);
    expect(() => db.$client.exec("DELETE FROM audit_log")).toThrow(/append-only/);
  });

  it("locked task rejects UPDATE", () => {
    const { db, libraryVersionId, configVersionId } = setup();
    const p = insertProject(db, libraryVersionId, configVersionId);
    const t = insertTask(db, p, "V-01", "locked");
    expect(() => db.update(taskInstances).set({ name: "changed" }).where(eq(taskInstances.id, t)).run()).toThrow(/locked task/);
  });

  it("closed project rejects new task rows and edits", () => {
    const { db, libraryVersionId, configVersionId } = setup();
    const p = insertProject(db, libraryVersionId, configVersionId);
    const t = insertTask(db, p, "V-01", "verified");
    db.update(projects).set({ closeStatus: "closed_locked" }).where(eq(projects.id, p)).run();
    expect(() => insertTask(db, p, "V-02")).toThrow(/closed and locked/);
    expect(() => db.update(taskInstances).set({ notes: "x" }).where(eq(taskInstances.id, t)).run()).toThrow(/closed and locked/);
    expect(() => db.update(projects).set({ name: "renamed" }).where(eq(projects.id, p)).run()).toThrow(/closed and locked/);
  });

  it("tasks can only be deleted from a draft plan", () => {
    const { db, libraryVersionId, configVersionId } = setup();
    const p = insertProject(db, libraryVersionId, configVersionId);
    const draft = insertTask(db, p, "V-01");
    const started = insertTask(db, p, "V-02", "in_progress");
    expect(() => db.delete(taskInstances).where(eq(taskInstances.id, draft)).run()).not.toThrow();
    expect(() => db.delete(taskInstances).where(eq(taskInstances.id, started)).run()).toThrow(/draft plan/);
  });
});

describe("audit chain", () => {
  it("chain verifies and detects tampering", () => {
    const { db, a } = setup();
    for (let i = 0; i < 3; i++) appendAudit(db, { at: T0.toISOString(), actorMemberId: a, action: "test.write", entityType: "x", entityId: i, after: { i } });
    expect(verifyAuditChain(db)).toEqual({ ok: true, count: 4 });
    // Simulate someone editing the file directly (bypassing the trigger).
    db.$client.exec("DROP TRIGGER audit_log_no_update");
    db.$client.exec("UPDATE audit_log SET after = '{\"i\":99}' WHERE id = 3");
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, firstBrokenId: 3, reason: "entry content does not match its hash" });
  });
});
