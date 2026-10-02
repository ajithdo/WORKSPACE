import { lookup } from "node:dns/promises";
import net from "node:net";
import { DomainError } from "./errors";

/** Blocks loopback, link-local (cloud metadata) and unspecified addresses; LAN staging servers are allowed. */
export function blockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 127 || a === 0 || (a === 169 && b === 254) || a! >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fe80") || v.startsWith("ff") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:169.254.");
}

export async function assertFetchable(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DomainError("invalid", "Enter a full address starting with http:// or https://");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new DomainError("invalid", "Only http:// and https:// addresses can be checked");
  if (u.username || u.password) throw new DomainError("invalid", "Remove the username and password from the address");
  const { address } = await lookup(u.hostname).catch(() => {
    throw new DomainError("invalid", `Could not find ${u.hostname}`);
  });
  if (blockedAddress(address)) {
    throw new DomainError("invalid", "The server cannot check localhost or internal addresses. Use the Preview tab for local sites, or check a staging or live address.");
  }
  return u;
}

export interface FetchResult {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Fetches at most maxBytes of text with a timeout; redirects are followed and re-checked. */
export async function safeFetch(raw: string, opts: { timeoutMs?: number; maxBytes?: number; redirect?: "follow" | "manual" } = {}): Promise<FetchResult> {
  let url = (await assertFetchable(raw)).toString();
  const max = opts.maxBytes ?? 400_000;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { "user-agent": "ContributionTracker-SiteCheck/1.0", accept: "text/html,*/*" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location && opts.redirect !== "manual") {
      url = (await assertFetchable(new URL(location, url).toString())).toString();
      continue;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body = "";
    if (res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        body += dec.decode(value, { stream: true });
        if (size >= max) {
          await reader.cancel();
          break;
        }
      }
    }
    return { status: res.status, url, headers, body };
  }
  throw new DomainError("invalid", "Too many redirects");
}
