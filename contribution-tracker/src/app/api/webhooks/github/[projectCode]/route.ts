import { getDb } from "@/db";
import { DomainError } from "@/server/errors";
import { ingestGithubPush, verifyGithubSignature } from "@/server/gitWebhook";

const MAX_BODY = 5 * 1024 * 1024;

/** GitHub push webhook: commits naming a task code become evidence. Configure with GITHUB_WEBHOOK_SECRET. */
export async function POST(req: Request, { params }: { params: Promise<{ projectCode: string }> }) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!secret) return new Response("Webhook not configured", { status: 404 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("Payload too large", { status: 413 });
  if (!verifyGithubSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  const event = req.headers.get("x-github-event");
  if (event === "ping") return Response.json({ ok: true });
  if (event !== "push") return new Response("Ignored", { status: 202 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  try {
    const result = ingestGithubPush(getDb(), new Date(), (await params).projectCode, payload as Parameters<typeof ingestGithubPush>[3]);
    return Response.json(result);
  } catch (e) {
    if (e instanceof DomainError) return new Response(e.message, { status: e.code === "not_found" ? 404 : 409 });
    throw e;
  }
}
