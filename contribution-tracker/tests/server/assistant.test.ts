import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aiReports, evidence } from "@/db/schema";
import { acceptSuggestion, runCompletionCheck, runResearch, setAiClientFactory, setSiteUrls } from "@/server/assistant";
import { blockedAddress } from "@/server/web";
import { bootstrap, taskByCode } from "../fixtures";

function fakeClient(parsed: unknown, research?: { text: string; url: string }) {
  return () =>
    ({
      beta: {
        messages: {
          parse: async () => ({ stop_reason: "end_turn", parsed_output: parsed }),
          create: async () => ({
            stop_reason: "end_turn",
            content: [
              { type: "web_search_tool_result", content: [{ type: "web_search_result", url: research?.url ?? "https://a.example", title: "A bakery" }] },
              { type: "text", text: research?.text ?? "Brief", citations: [] },
            ],
          }),
        },
      },
    }) as never;
}

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("completion check", () => {
  it("keeps only real open task codes and stores the report", async () => {
    const f = bootstrap();
    setAiClientFactory(
      fakeClient({
        summary: "Static site built",
        tasks: [
          { code: "AI-05", verdict: "done", confidence: "high", reason: "Sitemap mentioned in notes", evidenceUrl: "https://sunrise.example/sitemap.xml", evidenceType: "url_live" },
          { code: "ZZ-99", verdict: "done", confidence: "high", reason: "made up", evidenceUrl: null, evidenceType: null },
        ],
      }),
    );
    const { reportId } = await runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "Added sitemap.xml and robots.txt" });
    const r = f.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get();
    expect((r?.output as { tasks: { code: string }[] }).tasks.map((t) => t.code)).toEqual(["AI-05"]);
  });

  it("refuses to run without notes or a site", async () => {
    const f = bootstrap();
    setAiClientFactory(fakeClient({ summary: "", tasks: [] }));
    await expect(runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "" })).rejects.toThrow(/site address or paste notes/);
  });
});

describe("accepting a suggestion", () => {
  it("adds evidence but never verifies; the other partner still has to", () => {
    const f = bootstrap();
    const t = taskByCode(f, "D-01");
    const r = acceptSuggestion(f.at(f.b), f.projectId, { code: "D-01", evidenceType: "email_sent", url: "https://mail.example/thread", description: "Questionnaire email sent to the client" });
    expect(r.submitted).toBe(true);
    expect(taskByCode(f, "D-01").status).toBe("submitted");
    expect(f.db.select().from(evidence).where(eq(evidence.subjectId, t.id)).all()).toHaveLength(1);
  });
});

describe("research", () => {
  it("stores the brief, sources and only valid library codes", async () => {
    const f = bootstrap();
    setAiClientFactory(
      fakeClient(
        { summary: "Bakeries show menus", suggestions: [{ title: "Online cake orders", why: "Most top sites", priority: "must", exampleUrls: [], libraryCodes: ["AB-01", "NOPE-1"], newTask: null }] },
        { text: "Top bakery sites show prices", url: "https://bestbakery.example" },
      ),
    );
    const { reportId } = await runResearch(f.at(f.a), f.projectId, { niche: "bakery with custom cakes", location: "Hyderabad", focus: "" });
    const out = f.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get()?.output as { suggestions: { libraryCodes: string[] }[]; sources: { url: string }[] };
    expect(out.suggestions[0]?.libraryCodes).toEqual(["AB-01"]);
    expect(out.sources[0]?.url).toBe("https://bestbakery.example");
  });
});

describe("site addresses and fetch guard", () => {
  it("validates addresses", () => {
    const f = bootstrap();
    expect(() => setSiteUrls(f.at(f.a), f.projectId, { staging: "ftp://x" })).toThrow(/http/);
    setSiteUrls(f.at(f.a), f.projectId, { local: "http://localhost:3000", staging: "https://staging.example" });
  });
  it("blocks loopback and cloud metadata addresses", () => {
    expect(blockedAddress("127.0.0.1")).toBe(true);
    expect(blockedAddress("169.254.169.254")).toBe(true);
    expect(blockedAddress("::1")).toBe(true);
    expect(blockedAddress("192.168.1.20")).toBe(false);
    expect(blockedAddress("93.184.216.34")).toBe(false);
  });
});

describe("daily limit", () => {
  it("stops Claude requests once the day's limit is used", async () => {
    const f = bootstrap();
    process.env.AI_DAILY_LIMIT = "1";
    try {
      setAiClientFactory(fakeClient({ summary: "ok", tasks: [] }));
      await runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "Built the home page" });
      await expect(runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "Built the about page" })).rejects.toThrow(/limit of 1/);
      // The next day starts fresh.
      await runCompletionCheck(f.at(f.a, new Date(Date.parse("2026-10-03T09:00:00Z"))), f.projectId, { url: null, notes: "Built the contact page" });
    } finally {
      delete process.env.AI_DAILY_LIMIT;
    }
  });
});

describe("links from model output", () => {
  it("drops anything that is not a plain web link", async () => {
    const f = bootstrap();
    setAiClientFactory(
      fakeClient({
        summary: "x",
        tasks: [{ code: "AI-05", verdict: "done", confidence: "high", reason: "r", evidenceUrl: "javascript:alert(1)", evidenceType: "url_live" }],
      }),
    );
    const { reportId } = await runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "Added the sitemap" });
    const r = f.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get();
    expect((r?.output as { tasks: { evidenceUrl: string | null }[] }).tasks[0]?.evidenceUrl).toBeNull();
  });
});

describe("commits feed the completion check", () => {
  it("runs on recent commits alone and passes them to Claude", async () => {
    const { ingestGithubPush } = await import("@/server/gitWebhook");
    const { projects } = await import("@/db/schema");
    const f = bootstrap();
    const code = f.db.select().from(projects).where(eq(projects.id, f.projectId)).get()!.code;
    ingestGithubPush(f.db, f.at(f.a).now, code, { commits: [{ id: "e".repeat(40), message: "AI-05: add sitemap.xml generator", author: { email: "asha@studio.test" } }] });
    let seen = "";
    setAiClientFactory(
      () =>
        ({
          beta: {
            messages: {
              parse: async (req: { messages: { content: string }[] }) => {
                seen = req.messages[0]!.content;
                return { stop_reason: "end_turn", parsed_output: { summary: "ok", tasks: [] } };
              },
            },
          },
        }) as never,
    );
    await runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "" });
    expect(seen).toContain("eeeeeee on AI-05: AI-05: add sitemap.xml generator");
  });
});
