import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { autoBackup } from "@/server/backup";
import { testDb } from "../helpers";

describe("automatic daily backup", () => {
  it("writes one copy per day and keeps only the newest ones", async () => {
    const db = testDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-auto-"));
    for (let d = 1; d <= 5; d++) expect(await autoBackup(db, dir, new Date(`2026-10-0${d}T10:00:00Z`), 3)).toMatch(/auto-2026-10-0\d\.db$/);
    expect(await autoBackup(db, dir, new Date("2026-10-05T18:00:00Z"), 3)).toBeNull();
    expect(fs.readdirSync(dir).sort()).toEqual(["auto-2026-10-03.db", "auto-2026-10-04.db", "auto-2026-10-05.db"]);
  });
});
