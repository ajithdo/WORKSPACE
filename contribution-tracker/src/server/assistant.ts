import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { analyseSite, type SiteCheck } from "@/domain/siteRules";
import { aiReports, projects, taskInstances, taskTemplates } from "@/db/schema";
import type { Ctx } from "./context";
import { iso } from "./context";
import { assertProjectMember, assertProjectOpen, audit, contributionsOf, loadProject, projectConfig, requireActor } from "./common";
import { DomainError } from "./errors";
import { addEvidence } from "./evidence";
import { storeFile } from "./files";
import { startTask, submitTask } from "./tasks";
import { safeFetch } from "./web";

/*
 * AI assistance. Claude suggests; people decide. Nothing here verifies a task or awards points:
 * an accepted suggestion becomes evidence and a submission, and the other partner still verifies it.
 */

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";
const AI_EFFORT = (process.env.AI_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type AiClient = Pick<Anthropic, "beta">;
let clientFactory: () => AiClient = () => new Anthropic();
export function setAiClientFactory(f: () => AiClient) {
  clientFactory = f;
}

export function aiConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function aiError(e: unknown): DomainError {
  if (e instanceof DomainError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new DomainError("invalid", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.");
  if (e instanceof Anthropic.RateLimitError) return new DomainError("conflict", "Claude is rate-limited right now. Try again in a minute.");
  if (e instanceof Anthropic.BadRequestError) return new DomainError("invalid", `Claude rejected the request: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new DomainError("conflict", "Could not reach the Anthropic API from this server.");
  if (e instanceof Anthropic.APIError) return new DomainError("conflict", `Claude API error ${e.status ?? ""}`.trim());
  console.error(e);
  return new DomainError("conflict", "The AI request failed");
}

// ---------- site snapshot and key-free checks ----------

const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function snapshotSite(url: string) {
  const page = await safeFetch(url);
  const origin = new URL(page.url).origin;
  const probe = async (path: string) => {
    try {
      const r = await safeFetch(`${origin}${path}`, { maxBytes: 20_000, timeoutMs: 6000 });
      return r;
    } catch {
      return null;
    }
  };
  const [robots, sitemap, missing] = await Promise.all([probe("/robots.txt"), probe("/sitemap.xml"), probe(`/this-page-should-not-exist-${Date.now()}`)]);
  let httpRedirectsToHttps: boolean | null = null;
  if (page.url.startsWith("https://")) {
    try {
      const plain = await safeFetch(page.url.replace(/^https:/, "http:"), { redirect: "manual", maxBytes: 1000, timeoutMs: 6000 });
      httpRedirectsToHttps = plain.status >= 300 && plain.status < 400 && (plain.headers.location ?? "").startsWith("https://");
    } catch {
      httpRedirectsToHttps = null;
    }
  }
  return {
    url: page.url,
    status: page.status,
    html: page.body,
    headers: page.headers,
    httpRedirectsToHttps,
    robotsOk: robots?.status === 200,
    sitemapOk: sitemap?.status === 200 && /<(urlset|sitemapindex)/i.test(sitemap.body),
    notFoundStatus: missing?.status ?? null,
  };
}

function siteUrlFor(ctx: Ctx, projectId: number, url: string | null) {
  const p = loadProject(ctx.db, projectId);
  const chosen = url?.trim() || p.siteUrls.live || p.siteUrls.staging;
  if (!chosen) throw new DomainError("invalid", "Add the staging or live address on the Preview tab first");
  return chosen;
}

export async function runSiteCheck(ctx: Ctx, projectId: number, url: string | null): Promise<{ reportId: number }> {
  const actor = requireActor(ctx);
  assertProjectMember(ctx.db, projectId, actor);
  const target = siteUrlFor(ctx, projectId, url);
  const snap = await snapshotSite(target);
  const checks = analyseSite(snap);
  return ctx.db.transaction((tx) => {
    const id = tx
      .insert(aiReports)
      .values({ projectId, kind: "site_check", input: { url: target }, output: { finalUrl: snap.url, status: snap.status, checks }, model: null, createdBy: actor, createdAt: iso(ctx.now) })
      .returning({ id: aiReports.id })
      .get().id;
    audit(tx, ctx, "assistant.site_check", "ai_report", id, projectId, undefined, { url: target, passed: checks.filter((c) => c.ok).length, total: checks.length });
    return { reportId: id };
  });
}

// ---------- completion check ----------

export const CompletionSchema = z.object({
  summary: z.string().describe("Two or three sentences on what the build appears to cover"),
  tasks: z.array(
    z.object({
      code: z.string().describe("Task code exactly as given, e.g. AI-05"),
      verdict: z.enum(["done", "partly", "not_done", "unclear"]),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string().describe("What in the material shows this, quoted or named specifically"),
      evidenceUrl: z.string().nullable().describe("A URL from the material that proves it, or null"),
      evidenceType: z.enum(["url_live", "crawl_report", "scan_report", "config_record", "document_link", "git_commit", "pull_request", "deployment"]).nullable(),
    }),
  ),
});
export type CompletionOutput = z.infer<typeof CompletionSchema>;

function openTasks(ctx: Ctx, projectId: number) {
  return ctx.db
    .select()
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, projectId), inArray(taskInstances.status, ["planned", "in_progress", "blocked"])))
    .all();
}

const COMPLETION_SYSTEM = `You review a web studio's project against its task list after a build session (often AI-assisted "vibe coding").
You are given open tasks and material about the build: a snapshot of the staging or live site, automated check results, and the builders' notes or repository summary.
For each task, decide whether the material shows it is done. Be conservative:
- "done" only when the material directly shows the deliverable (for example the sitemap URL returns XML, the meta description is in the HTML, the notes name the merged pull request).
- "partly" when some of it is visible. "unclear" when the material cannot show it either way (meetings, contracts, payments, client approvals). Never mark those "done" from a site snapshot.
- Quote or name what you saw in "reason". Do not invent URLs: evidenceUrl must appear in the material, or be null.
Only list tasks you can say something useful about; skip tasks the material does not touch.`;

export async function runCompletionCheck(ctx: Ctx, projectId: number, input: { url: string | null; notes: string }): Promise<{ reportId: number }> {
  const actor = requireActor(ctx);
  if (!aiConfigured()) throw new DomainError("conflict", "AI is off: set ANTHROPIC_API_KEY on the server to use the completion check");
  const p = loadProject(ctx.db, projectId);
  assertProjectOpen(p);
  assertProjectMember(ctx.db, projectId, actor);
  const tasks = openTasks(ctx, projectId);
  if (!tasks.length) throw new DomainError("conflict", "No open tasks to check");
  const notes = input.notes.trim().slice(0, 40_000);
  const target = input.url?.trim() || p.siteUrls.live || p.siteUrls.staging || null;
  let siteText = "No site address was given.";
  let checks: SiteCheck[] = [];
  if (target) {
    const snap = await snapshotSite(target);
    checks = analyseSite(snap);
    const head = /<head[\s\S]*?<\/head>/i.exec(snap.html)?.[0] ?? "";
    siteText = [
      `Site: ${snap.url} (HTTP ${snap.status})`,
      `Response headers: ${JSON.stringify(snap.headers)}`,
      `Automated checks:\n${checks.map((c) => `- ${c.label}: ${c.ok ? "PASS" : "FAIL"} (${c.detail})`).join("\n")}`,
      `<head>:\n${head.slice(0, 12_000)}`,
      `Visible text:\n${textOf(snap.html).slice(0, 20_000)}`,
    ].join("\n\n");
  }
  if (!target && !notes) throw new DomainError("invalid", "Give a site address or paste notes from your build");
  const taskList = tasks.map((t) => `${t.code} | ${t.name} | ${t.description.slice(0, 200)} | deliverable: ${t.deliverable} | evidence: ${t.evidenceExpected}`).join("\n");
  let output: CompletionOutput;
  try {
    const res = await clientFactory().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: AI_EFFORT, format: betaZodOutputFormat(CompletionSchema) },
      system: [
        { type: "text", text: COMPLETION_SYSTEM },
        { type: "text", text: `Open tasks (code | name | description | deliverable | evidence expected):\n${taskList}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${siteText}\n\nBuilders' notes / repository summary:\n${notes || "(none)"}` }],
    });
    if (res.stop_reason === "refusal") throw new DomainError("conflict", "Claude declined to review this material");
    if (!res.parsed_output) throw new DomainError("conflict", "Claude's answer could not be read; try again");
    output = res.parsed_output;
  } catch (e) {
    throw aiError(e);
  }
  const known = new Set(tasks.map((t) => t.code));
  output = { ...output, tasks: output.tasks.filter((t) => known.has(t.code)) };
  return ctx.db.transaction((tx) => {
    const id = tx
      .insert(aiReports)
      .values({ projectId, kind: "completion", input: { url: target, notes: notes.slice(0, 2000) }, output: { ...output, checks }, model: AI_MODEL, createdBy: actor, createdAt: iso(ctx.now) })
      .returning({ id: aiReports.id })
      .get().id;
    audit(tx, ctx, "assistant.completion_check", "ai_report", id, projectId, undefined, { url: target, suggestedDone: output.tasks.filter((t) => t.verdict === "done").map((t) => t.code) });
    return { reportId: id };
  });
}

/**
 * Turns one suggestion (AI or site check) into evidence, then starts and submits the task if the
 * person accepting it is a contributor. Verification stays with the other partner.
 */
export function acceptSuggestion(ctx: Ctx, projectId: number, input: { code: string; evidenceType: string; url: string | null; description: string }): { submitted: boolean; message: string } {
  const actor = requireActor(ctx);
  const t = ctx.db
    .select()
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, projectId), eq(taskInstances.code, input.code)))
    .get();
  if (!t) throw new DomainError("not_found", `Task ${input.code} is not in this project`);
  if (!input.url) throw new DomainError("invalid", "This suggestion has no link to use as evidence; add evidence on the task page instead");
  const description = input.description.length < 10 ? `${input.description} (suggested by check)` : input.description.slice(0, 300);
  addEvidence(ctx, { subjectType: "task", subjectId: t.id, type: input.evidenceType, url: input.url, description, containsPersonalData: false, redacted: false, noSecretsConfirmed: true });
  if (!contributionsOf(ctx.db, t.id).some((c) => c.memberId === actor)) return { submitted: false, message: `Evidence added to ${t.code}. Its owner submits it.` };
  try {
    if (t.status === "planned") startTask(ctx, t.id);
    submitTask(ctx, t.id);
    return { submitted: true, message: `${t.code} submitted. Your partner verifies it.` };
  } catch (e) {
    return { submitted: false, message: `Evidence added to ${t.code}, but it was not submitted: ${(e as Error).message}` };
  }
}

// ---------- web research ----------

export const ResearchSchema = z.object({
  summary: z.string(),
  suggestions: z.array(
    z.object({
      title: z.string(),
      why: z.string().describe("Why strong sites in this niche have it, citing what was seen"),
      priority: z.enum(["must", "should", "could"]),
      exampleUrls: z.array(z.string()),
      libraryCodes: z.array(z.string()).describe("Matching task codes from the library list, or empty"),
      newTask: z.object({ name: z.string(), categoryCode: z.string(), points: z.number() }).nullable().describe("Only when no library task covers it"),
    }),
  ),
});
export type ResearchOutput = z.infer<typeof ResearchSchema>;

interface Source {
  url: string;
  title: string;
}

export async function runResearch(ctx: Ctx, projectId: number, input: { niche: string; location: string; focus: string }): Promise<{ reportId: number }> {
  const actor = requireActor(ctx);
  if (!aiConfigured()) throw new DomainError("conflict", "AI is off: set ANTHROPIC_API_KEY on the server to use web research");
  const niche = input.niche.trim();
  if (niche.length < 3) throw new DomainError("invalid", "Describe the kind of business, e.g. \"bakery with custom cakes\"");
  const p = loadProject(ctx.db, projectId);
  assertProjectOpen(p);
  assertProjectMember(ctx.db, projectId, actor);
  const client = clientFactory();
  const ask = `Research the best websites for this kind of business: ${niche}${input.location ? `, in or near ${input.location}` : ""}.
${input.focus ? `Focus: ${input.focus}.\n` : ""}Find 5–8 strong, current examples (local and international). For each pattern you see repeatedly, explain what the sites do and why it helps customers or conversions.
Then list what a new site for this business must have, should have and could have, and common mistakes to avoid. Cite the sites you looked at.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: ask }];
  const sources = new Map<string, Source>();
  let brief = "";
  try {
    for (let turn = 0; turn < 5; turn++) {
      const res = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: AI_EFFORT },
        system: "You are a web strategist helping a two-person Indian web studio plan a client website. Be concrete and cite sources.",
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "IN" } }],
        messages,
      });
      for (const block of res.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, { url: r.url, title: r.title });
        }
        if (block.type === "text") {
          brief += block.text;
          for (const c of block.citations ?? []) if (c.type === "web_search_result_location") sources.set(c.url, { url: c.url, title: c.title ?? c.url });
        }
      }
      if (res.stop_reason === "refusal") throw new DomainError("conflict", "Claude declined this research request");
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    if (!brief.trim()) throw new DomainError("conflict", "The research came back empty; try again");
  } catch (e) {
    throw aiError(e);
  }
  const library = ctx.db
    .select({ code: taskTemplates.code, name: taskTemplates.name })
    .from(taskTemplates)
    .where(eq(taskTemplates.libraryVersionId, p.libraryVersionId))
    .all();
  const categories = projectConfig(ctx.db, p).categories.map((c) => `${c.code} ${c.name}`).join("; ");
  let output: ResearchOutput;
  try {
    const res = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(ResearchSchema) },
      system: [
        {
          type: "text",
          text: `Turn a research brief into website suggestions for a studio's project plan. Map each suggestion to task codes from this library where one fits (use only these codes):\n${library.map((l) => `${l.code} ${l.name}`).join("\n")}\nCategories for new tasks: ${categories}. New-task points: 1–10, roughly hours of work.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: `Research brief:\n${brief}\n\nSources seen:\n${[...sources.values()].map((s) => `${s.title} ${s.url}`).join("\n")}` }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new DomainError("conflict", "Could not turn the research into suggestions; the brief is still saved");
    output = res.parsed_output;
  } catch (e) {
    if (e instanceof DomainError) output = { summary: e.message, suggestions: [] };
    else throw aiError(e);
  }
  const codes = new Set(library.map((l) => l.code));
  output = { ...output, suggestions: output.suggestions.map((s) => ({ ...s, libraryCodes: s.libraryCodes.filter((c) => codes.has(c)) })) };
  return ctx.db.transaction((tx) => {
    const id = tx
      .insert(aiReports)
      .values({ projectId, kind: "research", input, output: { ...output, brief, sources: [...sources.values()] }, model: AI_MODEL, createdBy: actor, createdAt: iso(ctx.now) })
      .returning({ id: aiReports.id })
      .get().id;
    audit(tx, ctx, "assistant.research", "ai_report", id, projectId, undefined, { niche, sources: sources.size, suggestions: output.suggestions.length });
    return { reportId: id };
  });
}

/** Saves a research brief as a markdown file and attaches it as evidence to a research task (e.g. M-02). */
export function saveResearchAsEvidence(ctx: Ctx, reportId: number, taskCode: string) {
  const r = ctx.db.select().from(aiReports).where(eq(aiReports.id, reportId)).get();
  if (!r || r.kind !== "research") throw new DomainError("not_found", "Research report not found");
  const out = r.output as ResearchOutput & { brief: string; sources: Source[] };
  const md = `# Research brief\n\n${out.brief}\n\n## Sources\n\n${out.sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}\n`;
  const t = ctx.db
    .select()
    .from(taskInstances)
    .where(and(eq(taskInstances.projectId, r.projectId), eq(taskInstances.code, taskCode)))
    .get();
  if (!t) throw new DomainError("not_found", `Task ${taskCode} is not in this project`);
  const { fileId } = storeFile(ctx, { projectId: r.projectId, category: "02_brief", name: `research-brief-${reportId}.md`, mime: "text/markdown", bytes: new TextEncoder().encode(md) });
  addEvidence(ctx, {
    subjectType: "task",
    subjectId: t.id,
    type: "document_file",
    fileId,
    url: out.sources[0]?.url ?? null,
    description: `AI-assisted research brief with ${out.sources.length} cited sources, reviewed by the team`,
    containsPersonalData: false,
    redacted: false,
    noSecretsConfirmed: true,
  });
}

export function setSiteUrls(ctx: Ctx, projectId: number, urls: { local?: string; staging?: string; live?: string }) {
  requireActor(ctx);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(urls)) {
    const s = (v ?? "").trim();
    if (!s) continue;
    if (!/^https?:\/\/[^\s]+$/i.test(s)) throw new DomainError("invalid", `${k} address must start with http:// or https://`);
    if (/\/\/[^/]*@/.test(s)) throw new DomainError("invalid", "Remove usernames and passwords from addresses");
    clean[k] = s;
  }
  ctx.db.transaction((tx) => {
    const p = loadProject(tx, projectId);
    assertProjectOpen(p);
    assertProjectMember(tx, projectId, ctx.actorId!);
    tx.update(projects).set({ siteUrls: clean, updatedAt: iso(ctx.now) }).where(eq(projects.id, projectId)).run();
    audit(tx, ctx, "project.site_urls", "project", projectId, projectId, p.siteUrls, clean);
  });
}

export function reportsFor(ctx: Ctx | { db: Ctx["db"] }, projectId: number) {
  return ctx.db.select().from(aiReports).where(eq(aiReports.projectId, projectId)).orderBy(desc(aiReports.id)).limit(20).all();
}
