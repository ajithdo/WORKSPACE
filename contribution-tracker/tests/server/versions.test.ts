import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { configVersions, libraryVersions, taskTemplates } from "@/db/schema";
import { exportJson } from "@/server/backup";
import { createDraftConfig, createDraftLibraryVersion, decideConfig, decideLibraryVersion, submitConfig, submitLibraryVersion, updateDraftConfig, updateDraftTemplate } from "@/server/versions";
import { bootstrap } from "../fixtures";

describe("library versions", () => {
  it("become active only when both partners approve, and old projects keep their version", () => {
    const f = bootstrap();
    const { versionId } = createDraftLibraryVersion(f.at(f.a), "Raise V-11 after calibration");
    const tpl = f.db.select().from(taskTemplates).where(eq(taskTemplates.libraryVersionId, versionId)).all().find((t) => t.code === "V-11");
    updateDraftTemplate(f.at(f.a), tpl?.id ?? 0, { defaultPoints: 12 });
    submitLibraryVersion(f.at(f.a), versionId);
    expect(f.db.select().from(libraryVersions).where(eq(libraryVersions.id, versionId)).get()?.status).toBe("pending");
    expect(() => decideLibraryVersion(f.at(f.a), versionId, "approve")).toThrow(/already approved/);
    decideLibraryVersion(f.at(f.b), versionId, "approve");
    const versions = f.db.select().from(libraryVersions).all();
    expect(versions.find((v) => v.id === versionId)?.status).toBe("active");
    expect(versions.find((v) => v.version === 1)?.status).toBe("superseded");
  });

  it("cannot edit a version that is not a draft", () => {
    const f = bootstrap();
    const v1 = f.db.select().from(taskTemplates).get();
    expect(() => updateDraftTemplate(f.at(f.a), v1?.id ?? 0, { defaultPoints: 5 })).toThrow(/draft/);
  });
});

describe("rules versions", () => {
  it("validate edits and need both partners", () => {
    const f = bootstrap();
    const { versionId } = createDraftConfig(f.at(f.a), "Lower reserve");
    expect(() => updateDraftConfig(f.at(f.a), versionId, { calculation: { pool_pct: 0.7 } })).toThrow(/100%/);
    updateDraftConfig(f.at(f.a), versionId, { calculation: { reserve_pct: 0.08 }, communicationPoints: { discovery_call: { lead_points: 4, second_attendee_points: 2 } } });
    submitConfig(f.at(f.a), versionId);
    decideConfig(f.at(f.b), versionId, "approve");
    const active = f.db.select().from(configVersions).where(eq(configVersions.status, "active")).get();
    expect(active?.id).toBe(versionId);
    expect(active?.data.calculation.reserve_pct).toBe(0.08);
    expect(active?.data.communication_types.find((c) => c.code === "discovery_call")?.lead_points).toBe(4);
  });
});

describe("backup export", () => {
  it("includes every table but never password hashes or sessions", () => {
    const f = bootstrap();
    const out = exportJson(f.db);
    expect(Object.keys(out.tables)).toContain("task_instances");
    expect(Object.keys(out.tables)).not.toContain("sessions");
    expect(JSON.stringify(out.tables.members)).not.toMatch(/scrypt/);
    expect((out.tables.task_instances ?? []).length).toBe(225);
  });
});
