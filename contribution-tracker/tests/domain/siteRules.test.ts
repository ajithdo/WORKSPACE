import { describe, expect, it } from "vitest";
import { analyseSite } from "@/domain/siteRules";

const good = `<!doctype html><html lang="en"><head><title>Sunrise Bakery</title>
<meta name="description" content="Fresh bread in Hyderabad"><meta name="viewport" content="width=device-width">
<link rel="canonical" href="https://sunrise.example/"><meta property="og:title" content="Sunrise"><meta property="og:image" content="https://sunrise.example/og.png">
<link rel="icon" href="/favicon.ico"><script type="application/ld+json">{"@type":"Bakery"}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script></head>
<body><header><nav></nav></header><main><h1>Bread</h1><img src="/a.jpg" alt="Loaf"><a href="/privacy-policy">Privacy</a></main></body></html>`;

const headers = {
  "strict-transport-security": "max-age=63072000",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin",
  "x-frame-options": "DENY",
};

const byId = (r: ReturnType<typeof analyseSite>, id: string) => r.find((c) => c.id === id);

describe("site rules", () => {
  it("passes a well-built page and maps checks to library tasks", () => {
    const r = analyseSite({ url: "https://sunrise.example/", html: good, headers, httpRedirectsToHttps: true, robotsOk: true, sitemapOk: true, notFoundStatus: 404 });
    expect(r.filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
    expect(byId(r, "meta")?.taskCodes).toEqual(["AI-02"]);
    expect(byId(r, "sitemap")?.taskCodes).toEqual(["AI-05"]);
  });

  it("flags missing basics", () => {
    const r = analyseSite({ url: "http://bad.example/", html: "<html><body><h1>a</h1><h1>b</h1><img src=x></body></html>", headers: {}, httpRedirectsToHttps: false, robotsOk: false, sitemapOk: false, notFoundStatus: 200 });
    for (const id of ["https", "redirect", "headers", "meta", "headings", "sitemap", "robots", "alt", "lang", "not_found"]) expect(byId(r, id)?.ok, id).toBe(false);
    expect(byId(r, "alt")?.detail).toMatch(/1 image/);
  });

  it("detects mixed content on https pages", () => {
    const r = analyseSite({ url: "https://x.example/", html: good.replace('src="/a.jpg"', 'src="http://cdn.example/a.jpg"'), headers, httpRedirectsToHttps: true, robotsOk: true, sitemapOk: true, notFoundStatus: 404 });
    expect(byId(r, "mixed")?.ok).toBe(false);
  });
});
