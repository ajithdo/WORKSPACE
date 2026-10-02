import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aiReports } from "@/db/schema";
import { aiModel, aiProvider, runCompletionCheck, runResearch } from "@/server/assistant";
import { extractJson, setOpenRouterFetch } from "@/server/openrouter";
import { bootstrap } from "../fixtures";

type Body = { model: string; messages: { role: string; content: string }[]; response_format?: unknown; plugins?: unknown };

/** Stubs OpenRouter: each call takes the next reply. Requests are recorded for assertions. */
function stub(replies: (Response | ((b: Body) => Response))[]) {
  const seen: Body[] = [];
  setOpenRouterFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    seen.push(body);
    const next = replies.shift();
    if (!next) throw new Error("unexpected OpenRouter call");
    return typeof next === "function" ? next(body) : next;
  });
  return seen;
}
const reply = (content: string, extra: Record<string, unknown> = {}) =>
  Response.json({ model: "nvidia/nemotron-free:free", choices: [{ message: { role: "assistant", content, ...extra } }] });

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OPENROUTER_API_KEY = "or-test-key";
});
afterAll(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_WEB_SEARCH;
});
beforeEach(() => {
  delete process.env.OPENROUTER_WEB_SEARCH;
});

describe("OpenRouter provider", () => {
  it("is picked when only its key is set, with the free router as the default model", () => {
    expect(aiProvider()).toBe("openrouter");
    expect(aiModel()).toBe("openrouter/free");
  });

  it("reads a fenced, slightly off-schema answer and records the model that answered", async () => {
    const f = bootstrap();
    const seen = stub([
      reply(
        '<think>{"draft": true}</think>Here you go:\n```json\n{"summary":"Static site built","tasks":[{"code":"AI-05","verdict":"Done","confidence":"high","reason":"sitemap in notes","evidenceUrl":"https://sunrise.example/sitemap.xml"},{"code":"D-01","verdict":"not done","confidence":"low","reason":"no sign"}]}\n```',
      ),
    ]);
    const { reportId } = await runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "Added sitemap.xml" });
    const r = f.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get()!;
    const out = r.output as { tasks: { code: string; verdict: string; evidenceType: string | null }[] };
    expect(out.tasks.map((t) => [t.code, t.verdict])).toEqual([
      ["AI-05", "done"],
      ["D-01", "not_done"],
    ]);
    expect(out.tasks[0]?.evidenceType).toBeNull();
    expect(r.model).toBe("nvidia/nemotron-free:free");
    expect(seen[0]?.model).toBe("openrouter/free");
    expect(seen[0]?.response_format).toBeTruthy();
    expect(seen[0]?.messages[0]?.content).toContain("JSON Schema");
  });

  it("retries without response_format when the model rejects it", async () => {
    const f = bootstrap();
    const seen = stub([Response.json({ error: { message: "response_format not supported" } }, { status: 400 }), reply('{"summary":"ok","tasks":[]}')]);
    await runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "Built the home page" });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.response_format).toBeUndefined();
  });

  it("asks once more when the answer is not JSON, then gives a clear error", async () => {
    const f = bootstrap();
    stub([reply("Sorry, I can't format that."), reply("Still prose.")]);
    await expect(runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "Built the home page" })).rejects.toThrow(/could not be read/);
  });

  it("explains a rejected key and the free-tier limit", async () => {
    const f = bootstrap();
    stub([Response.json({ error: { message: "No auth" } }, { status: 401 })]);
    await expect(runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "x notes" })).rejects.toThrow(/OPENROUTER_API_KEY/);
    stub([Response.json({ error: { message: "Rate limit" } }, { status: 429 })]);
    await expect(runCompletionCheck(f.at(f.a), f.projectId, { url: null, notes: "x notes" })).rejects.toThrow(/free requests are used up/);
  });

  it("researches without web search by default and marks the report as not live", async () => {
    const f = bootstrap();
    const seen = stub([
      reply("Top bakery sites show cake galleries and WhatsApp ordering."),
      reply('{"summary":"Bakeries","suggestions":[{"title":"Cake gallery","why":"common","priority":"Must","libraryCodes":["AB-01","NOPE-1"]}]}'),
    ]);
    const { reportId } = await runResearch(f.at(f.a), f.projectId, { niche: "bakery with custom cakes", location: "Hyderabad", focus: "" });
    expect(seen[0]?.plugins).toBeUndefined();
    expect(seen[0]?.messages[0]?.content).toContain("cannot browse");
    const out = f.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get()?.output as {
      liveSearch: boolean;
      sources: unknown[];
      suggestions: { priority: string; libraryCodes: string[]; exampleUrls: string[] }[];
    };
    expect(out.liveSearch).toBe(false);
    expect(out.sources).toEqual([]);
    expect(out.suggestions[0]).toMatchObject({ priority: "must", libraryCodes: ["AB-01"], exampleUrls: [] });
  });

  it("uses the paid web plugin only when asked, and keeps its citations", async () => {
    process.env.OPENROUTER_WEB_SEARCH = "true";
    const f = bootstrap();
    const seen = stub([
      reply("Brief with sources", { annotations: [{ type: "url_citation", url_citation: { url: "https://bestbakery.example", title: "Best Bakery" } }] }),
      reply('{"summary":"s","suggestions":[]}'),
    ]);
    const { reportId } = await runResearch(f.at(f.a), f.projectId, { niche: "bakery", location: "", focus: "" });
    expect(seen[0]?.plugins).toEqual([{ id: "web", max_results: 8 }]);
    const out = f.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get()?.output as { liveSearch: boolean; sources: { url: string }[] };
    expect(out.liveSearch).toBe(true);
    expect(out.sources[0]?.url).toBe("https://bestbakery.example");
  });

  it("keeps the brief when the suggestions step fails", async () => {
    const f = bootstrap();
    stub([reply("A useful brief."), Response.json({ error: { message: "overloaded" } }, { status: 503 })]);
    const { reportId } = await runResearch(f.at(f.a), f.projectId, { niche: "bakery", location: "", focus: "" });
    const out = f.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get()?.output as { brief: string; suggestions: unknown[] };
    expect(out.brief).toBe("A useful brief.");
    expect(out.suggestions).toEqual([]);
  });
});

describe("extractJson", () => {
  it("finds the object in prose, fences and think blocks", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>{"x":0}</think> Answer: {"a":2} done')).toEqual({ a: 2 });
    expect(extractJson("no json")).toBeNull();
  });
});
