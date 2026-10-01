import { describe, expect, it } from "vitest";
import seedTasks from "../../seed/seed_tasks.json";
import seedConfig from "../../seed/seed_config.json";
import {
  findDependencyCycle,
  isBusinessLevelTask,
  normaliseSeedTasks,
  parseEffort,
  parseOwnerRoles,
  selectTemplatesForType,
} from "@/domain/library";
import { parseStudioConfig } from "@/domain/config";

const config = parseStudioConfig(seedConfig);
const templates = normaliseSeedTasks(seedTasks.tasks, config);

describe("effort parsing", () => {
  it("takes the midpoint of a range in hours", () => {
    expect(parseEffort("2–4 h")).toEqual({ midHours: 3, unit: null });
  });
  it("converts minutes", () => {
    expect(parseEffort("15–30 min")).toEqual({ midHours: 0.375, unit: null });
    expect(parseEffort("10 min")).toEqual({ midHours: 10 / 60, unit: null });
  });
  it("parses per-unit efforts", () => {
    expect(parseEffort("1–2 h/page")).toEqual({ midHours: 1.5, unit: "page" });
    expect(parseEffort("10 min each")).toEqual({ midHours: 10 / 60, unit: "each" });
    expect(parseEffort("1–3 h per 20 leads")).toEqual({ midHours: 2, unit: "20 leads" });
    expect(parseEffort("0.5–1 h/month")).toEqual({ midHours: 0.75, unit: "month" });
  });
  it("returns null hours when effort is not numeric", () => {
    expect(parseEffort("Varies")).toEqual({ midHours: null, unit: null });
    expect(parseEffort("Built into dev")).toEqual({ midHours: null, unit: null });
  });
  it("ignores trailing notes", () => {
    expect(parseEffort("1–1.5 h incl. notes")).toEqual({ midHours: 1.25, unit: null });
  });
});

describe("owner roles", () => {
  it("splits combined roles", () => {
    expect(parseOwnerRoles("FE/BE")).toEqual({ roles: ["FE", "BE"], both: false });
    expect(parseOwnerRoles("Client + PM")).toEqual({ roles: ["Client", "PM"], both: false });
  });
  it("detects tasks both partners share", () => {
    expect(parseOwnerRoles("Either (both)")).toEqual({ roles: ["Either"], both: true });
    expect(parseOwnerRoles("Either (both confirm)")).toEqual({ roles: ["Either"], both: true });
  });
  it("maps Dev to FE and BE and drops notes", () => {
    expect(parseOwnerRoles("PM/Dev")).toEqual({ roles: ["PM", "FE", "BE"], both: false });
    expect(parseOwnerRoles("QA (not the builder where possible)")).toEqual({ roles: ["QA"], both: false });
  });
});

describe("seed library", () => {
  it("normalises all 343 tasks with phases from their category", () => {
    expect(templates).toHaveLength(343);
    expect(templates.find((t) => t.code === "V-09")).toMatchObject({ phase: "development", defaultPoints: 4, categoryCode: "V" });
    expect(templates.find((t) => t.code === "K-01")?.phase).toBe("throughout");
  });

  it("seed has no dependency cycles", () => {
    expect(findDependencyCycle(templates.map((t) => ({ code: t.code, dependsOn: t.dependsOn })))).toBeNull();
  });

  it("finds a cycle when one exists", () => {
    expect(
      findDependencyCycle([
        { code: "A", dependsOn: ["C"] },
        { code: "B", dependsOn: ["A"] },
        { code: "C", dependsOn: ["B"] },
      ]),
    ).toEqual(["A", "C", "B", "A"]);
  });

  it("marks business-level tasks", () => {
    expect(isBusinessLevelTask("Business-level, ongoing", false)).toBe(true);
    expect(isBusinessLevelTask("Closure", true)).toBe(true);
    expect(isBusinessLevelTask("Closure", false)).toBe(false);
    expect(templates.filter((t) => t.isBusinessLevel).map((t) => t.code).sort()).toEqual(["A-01", "A-04", "BO-01", "BO-02"]);
  });
});

describe("project types", () => {
  const count = (type: Parameters<typeof selectTemplatesForType>[1], multilingual = false) =>
    selectTemplatesForType(templates, type, { multilingual }).length;

  it("brochure selects 225 tasks worth 349 points", () => {
    const picked = selectTemplatesForType(templates, "brochure", { multilingual: false });
    expect(picked).toHaveLength(225);
    expect(picked.reduce((s, t) => s + t.defaultPoints, 0)).toBe(349);
  });
  it("cms, ecommerce and booking add their modules", () => {
    expect(count("cms")).toBe(230);
    expect(count("ecommerce")).toBe(243);
    expect(count("booking")).toBe(229);
  });
  it("multilingual adds BM tasks", () => {
    expect(count("brochure", true)).toBe(228);
  });
  it("studio and maintenance projects get their own task sets", () => {
    expect(selectTemplatesForType(templates, "studio", { multilingual: false }).map((t) => t.code).sort()).toEqual([
      "A-01",
      "A-04",
      "BO-01",
      "BO-02",
    ]);
    expect(count("maintenance")).toBe(9);
    expect(count("custom")).toBe(0);
  });
});
