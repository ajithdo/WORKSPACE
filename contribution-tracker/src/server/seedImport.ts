import fs from "node:fs";
import path from "node:path";
import { parseStudioConfig, withAppDefaults } from "@/domain/config";
import { findDependencyCycle, normaliseSeedTasks, type SeedTask } from "@/domain/library";
import { categoryTemplates, configVersions, libraryVersions, taskTemplates } from "@/db/schema";
import { appendAudit } from "./audit";
import type { Ctx } from "./context";
import { iso } from "./context";
import { DomainError } from "./errors";

export const SEED_DIR = path.join(process.cwd(), "seed");

function readSeed<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(SEED_DIR, name), "utf-8")) as T;
}

/** Validates library data before it is stored: unknown dependencies, cycles, milestone task ids. */
export function validateLibrary(templates: { code: string; dependsOn: string[] }[], milestoneTaskCodes: string[]) {
  const codes = new Set(templates.map((t) => t.code));
  for (const t of templates) {
    for (const d of t.dependsOn) if (!codes.has(d)) throw new DomainError("invalid", `Task ${t.code} depends on unknown task ${d}`);
  }
  const cycle = findDependencyCycle(templates);
  if (cycle) throw new DomainError("invalid", `Task dependencies form a cycle: ${cycle.join(" → ")}`);
  for (const c of milestoneTaskCodes) if (!codes.has(c)) throw new DomainError("invalid", `Milestone refers to unknown task ${c}`);
}

/** First-run import of seed_tasks.json and seed_config.json as library v1 and config v1 (both active). */
export function importSeedLibrary(ctx: Ctx): { libraryVersionId: number; configVersionId: number } {
  const config = withAppDefaults(parseStudioConfig(readSeed("seed_config.json")));
  const seed = readSeed<{ version: string; tasks: SeedTask[] }>("seed_tasks.json");
  const templates = normaliseSeedTasks(seed.tasks, config);
  validateLibrary(
    templates,
    config.milestones.flatMap((m) => [...m.complete_when, ...(m.blocks_tasks ?? [])]),
  );
  const now = iso(ctx.now);
  return ctx.db.transaction((tx) => {
    if (tx.select({ id: libraryVersions.id }).from(libraryVersions).limit(1).get()) {
      throw new DomainError("conflict", "The task library has already been imported");
    }
    const lib = tx
      .insert(libraryVersions)
      .values({ version: 1, status: "active", source: "seed", note: `Imported from seed_tasks.json v${seed.version}`, createdBy: ctx.actorId, createdAt: now, activatedAt: now })
      .returning({ id: libraryVersions.id })
      .get();
    tx.insert(categoryTemplates)
      .values(
        config.categories.map((c, i) => ({
          libraryVersionId: lib.id,
          code: c.code,
          name: c.name,
          phase: c.phase,
          isCommunication: c.is_communication,
          isSales: c.is_sales,
          isBusinessLevel: c.is_business_level,
          sortOrder: i,
        })),
      )
      .run();
    for (let i = 0; i < templates.length; i += 50) {
      tx.insert(taskTemplates)
        .values(templates.slice(i, i + 50).map((t) => ({ ...t, libraryVersionId: lib.id })))
        .run();
    }
    const cfg = tx
      .insert(configVersions)
      .values({ version: 1, status: "active", data: config, note: `Imported from seed_config.json v${config.version}`, createdBy: ctx.actorId, createdAt: now, activatedAt: now })
      .returning({ id: configVersions.id })
      .get();
    appendAudit(tx, {
      at: now,
      actorMemberId: ctx.actorId,
      action: "library.import",
      entityType: "library_version",
      entityId: lib.id,
      after: { libraryVersion: 1, configVersion: 1, categories: config.categories.length, tasks: templates.length },
    });
    return { libraryVersionId: lib.id, configVersionId: cfg.id };
  });
}
