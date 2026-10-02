import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { evidence } from "@/db/schema";
import { ingestGithubPush, verifyGithubSignature } from "@/server/gitWebhook";
import { bootstrap, taskByCode } from "../fixtures";
import { T0 } from "../helpers";

describe("GitHub webhook", () => {
  it("accepts only correctly signed deliveries", () => {
    const body = '{"zen":"hi"}';
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyGithubSignature("s3cret", body, sig)).toBe(true);
    expect(verifyGithubSignature("s3cret", body + " ", sig)).toBe(false);
    expect(verifyGithubSignature("other", body, sig)).toBe(false);
    expect(verifyGithubSignature("", body, sig)).toBe(false);
    expect(verifyGithubSignature("s3cret", body, null)).toBe(false);
  });

  it("turns commits that name a task into evidence for the matching partner, once", async () => {
    const { projects } = await import("@/db/schema");
    const f = bootstrap();
    const code = f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()!.code;
    const push = {
      commits: [
        { id: "a".repeat(40), message: "AI-05: add sitemap.xml and robots.txt\n\nDetails", url: "https://github.com/x/y/commit/aaa", author: { email: "ASHA@studio.test" } },
        { id: "b".repeat(40), message: "Fix typo on home page", author: { email: "asha@studio.test" } },
        { id: "c".repeat(40), message: "AI-06 robots tweak", author: { email: "intern@example.com" } },
        { id: "d".repeat(40), message: "AI-07 add schema, token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", author: { email: "bala@studio.test" } },
      ],
    };
    const r = ingestGithubPush(f.db, T0, code, push);
    expect(r.added).toEqual([{ commit: "aaaaaaa", task: "AI-05" }]);
    expect(r.skipped.map((s) => s.commit)).toEqual(["ccccccc", "ddddddd"]);
    const t = taskByCode(f, "AI-05");
    const ev = f.db.select().from(evidence).where(and(eq(evidence.subjectType, "task"), eq(evidence.subjectId, t.id))).all();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "git_commit", strength: "strong", submittedBy: f.a, externalRef: "a".repeat(40), description: "AI-05: add sitemap.xml and robots.txt" });
    // Redelivery adds nothing.
    expect(ingestGithubPush(f.db, T0, code, push).added).toEqual([]);
  });
});
