import { z } from "zod";
import { DomainError } from "./errors";

/*
 * OpenRouter (https://openrouter.ai), an OpenAI-compatible gateway with free models. Used by the
 * assistant when OPENROUTER_API_KEY is set instead of ANTHROPIC_API_KEY. Free models vary in quality
 * and don't all honour structured output, so answers are parsed leniently and validated with zod.
 */

export const OPENROUTER_FREE_MODEL = "openrouter/free";

let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
/** Tests replace the network with a stub. */
export function setOpenRouterFetch(f: typeof fetch) {
  fetchImpl = f;
}

export interface OpenRouterResult<T> {
  text: string;
  parsed: T | null;
  /** The model that actually answered (openrouter/free routes to one of the free models). */
  model: string;
  citations: { url: string; title: string }[];
}

interface ChatOptions<T> {
  model: string;
  system: string;
  user: string;
  /** Ask for JSON matching this schema; `parsed` is null when the answer doesn't fit. */
  schema?: z.ZodType<T>;
  /** Fixes common small deviations (missing nullable fields, "not done" for "not_done") before validation. */
  prepare?: (value: unknown) => unknown;
  /** OpenRouter's web plugin. It is billed per search, so it needs credits even with a free model. */
  webSearch?: boolean;
  maxTokens?: number;
}

/** Pulls the JSON object out of a reply that may be fenced, prefixed with prose or include <think> blocks. */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function keyMissing(): never {
  throw new DomainError("conflict", "AI is off: set OPENROUTER_API_KEY on the server");
}

async function post(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const key = process.env.OPENROUTER_API_KEY || keyMissing();
  const base = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Contribution Tracker" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") throw new DomainError("conflict", "The AI took too long to answer. Try again; free models are sometimes slow.");
    throw new DomainError("conflict", "Could not reach OpenRouter from this server");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

function errorFor(status: number, json: Record<string, unknown> | null): DomainError {
  const message = String((json?.error as { message?: unknown } | undefined)?.message ?? "").slice(0, 200);
  if (status === 401) return new DomainError("invalid", "OpenRouter rejected the key. Check OPENROUTER_API_KEY on the server.");
  if (status === 402) return new DomainError("conflict", "OpenRouter says this request needs credits. Free models (openrouter/free or names ending in :free) cost nothing; web search does not.");
  if (status === 429) return new DomainError("conflict", "OpenRouter's free models are busy or today's free requests are used up. Try again later.");
  return new DomainError("conflict", `OpenRouter error${status ? ` ${status}` : ""}${message ? `: ${message}` : ""}`);
}

export async function openRouterChat<T = never>(opts: ChatOptions<T>): Promise<OpenRouterResult<T>> {
  const jsonSchema = opts.schema ? z.toJSONSchema(opts.schema) : null;
  const system = jsonSchema
    ? `${opts.system}\n\nReply with one JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(jsonSchema)}`
    : opts.system;
  const base: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: opts.user },
    ],
    ...(opts.webSearch ? { plugins: [{ id: "web", max_results: 8 }] } : {}),
  };
  const withFormat = jsonSchema ? { ...base, response_format: { type: "json_schema", json_schema: { name: "answer", strict: false, schema: jsonSchema } } } : base;

  // Two attempts: some free models reject response_format or return text that isn't the JSON asked for.
  let last: OpenRouterResult<T> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let { status, json } = await post(attempt === 0 ? withFormat : base);
    if (status === 400 && attempt === 0 && jsonSchema) ({ status, json } = await post(base));
    if (status < 200 || status >= 300 || !json || json.error) throw errorFor(status, json);
    const choice = (json.choices as { message?: { content?: unknown; annotations?: unknown } }[] | undefined)?.[0]?.message;
    const text = typeof choice?.content === "string" ? choice.content : "";
    const citations = Array.isArray(choice?.annotations)
      ? (choice.annotations as { type?: string; url_citation?: { url?: string; title?: string } }[])
          .filter((a) => a.type === "url_citation" && typeof a.url_citation?.url === "string")
          .map((a) => ({ url: a.url_citation!.url!, title: a.url_citation!.title || a.url_citation!.url! }))
      : [];
    const model = typeof json.model === "string" ? json.model : opts.model;
    if (!opts.schema) return { text, parsed: null, model, citations };
    const raw = extractJson(text);
    const checked = raw === null ? null : opts.schema.safeParse(opts.prepare ? opts.prepare(raw) : raw);
    last = { text, parsed: checked?.success ? checked.data : null, model, citations };
    if (last.parsed) return last;
  }
  return last!;
}
