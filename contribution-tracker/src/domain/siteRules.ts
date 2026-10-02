/**
 * Automated checks on a live or staging page. Each check names the library tasks it is evidence for.
 * A passing check only *suggests* a task is done — a partner still submits and the other verifies.
 */
export interface SiteSnapshot {
  url: string;
  html: string;
  headers: Record<string, string>;
  httpRedirectsToHttps: boolean | null;
  robotsOk: boolean;
  sitemapOk: boolean;
  notFoundStatus: number | null;
}

export interface SiteCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  taskCodes: string[];
}

const has = (html: string, re: RegExp) => re.test(html);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

export function analyseSite(s: SiteSnapshot): SiteCheck[] {
  const h = s.html;
  const hdr = (k: string) => s.headers[k.toLowerCase()] ?? "";
  const https = s.url.startsWith("https://");
  const title = /<title[^>]*>\s*([^<]+?)\s*<\/title>/i.exec(h)?.[1] ?? "";
  const desc = has(h, /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i);
  const h1 = count(h, /<h1[\s>]/gi);
  const imgs = h.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgs.filter((i) => !/\balt=/i.test(i)).length;
  const secHeaders = ["content-security-policy", "x-content-type-options", "referrer-policy"].filter((k) => !hdr(k));
  const frameProtected = !!hdr("x-frame-options") || /frame-ancestors/i.test(hdr("content-security-policy"));
  const mixed = https ? count(h, /(?:src|href)=["']http:\/\/[^"']+\.(?:js|css|png|jpe?g|gif|webp|svg|woff2?)["']/gi) + count(h, /<script[^>]+src=["']http:\/\//gi) : 0;
  const checks: SiteCheck[] = [
    { id: "https", label: "Served over HTTPS", ok: https, detail: https ? "Page loads over HTTPS" : "Page is served over plain HTTP", taskCodes: ["AY-01"] },
    {
      id: "redirect",
      label: "HTTP redirects to HTTPS",
      ok: s.httpRedirectsToHttps === true,
      detail: s.httpRedirectsToHttps === null ? "Could not test the http:// address" : s.httpRedirectsToHttps ? "http:// redirects to https://" : "http:// does not redirect to https://",
      taskCodes: ["AY-02"],
    },
    { id: "mixed", label: "No mixed content", ok: mixed === 0, detail: mixed ? `${mixed} insecure http:// resource(s) on an HTTPS page` : "No insecure resources found", taskCodes: ["AY-03"] },
    {
      id: "headers",
      label: "Security headers",
      ok: secHeaders.length === 0 && (!https || !!hdr("strict-transport-security")) && frameProtected,
      detail: [
        secHeaders.length ? `missing ${secHeaders.join(", ")}` : "",
        https && !hdr("strict-transport-security") ? "no HSTS" : "",
        frameProtected ? "" : "no clickjacking protection (X-Frame-Options or frame-ancestors)",
      ]
        .filter(Boolean)
        .join("; ") || "CSP, HSTS, nosniff, referrer policy and frame protection present",
      taskCodes: ["AM-02"],
    },
    { id: "meta", label: "Title and meta description", ok: title.length >= 5 && desc, detail: `${title ? `Title "${title.slice(0, 60)}"` : "No title"}; ${desc ? "description present" : "no useful meta description"}`, taskCodes: ["AI-02"] },
    { id: "headings", label: "One H1 per page", ok: h1 === 1, detail: `${h1} H1 heading(s)`, taskCodes: ["AI-03"] },
    { id: "canonical", label: "Canonical tag", ok: has(h, /<link[^>]+rel=["']canonical["']/i), detail: has(h, /rel=["']canonical/i) ? "Present" : "Missing", taskCodes: ["AI-04"] },
    { id: "sitemap", label: "XML sitemap", ok: s.sitemapOk, detail: s.sitemapOk ? "/sitemap.xml found" : "/sitemap.xml not found", taskCodes: ["AI-05"] },
    { id: "robots", label: "robots.txt", ok: s.robotsOk, detail: s.robotsOk ? "/robots.txt found" : "/robots.txt not found", taskCodes: ["AI-06"] },
    { id: "schema", label: "Structured data", ok: has(h, /application\/ld\+json/i), detail: has(h, /application\/ld\+json/i) ? "JSON-LD present" : "No JSON-LD", taskCodes: ["AI-07"] },
    { id: "og", label: "Open Graph tags", ok: has(h, /property=["']og:title/i) && has(h, /property=["']og:image/i), detail: "og:title and og:image", taskCodes: ["AI-08"] },
    {
      id: "analytics",
      label: "Analytics tag",
      ok: has(h, /googletagmanager\.com|gtag\(|plausible\.io|umami|clarity\.ms|matomo/i),
      detail: has(h, /googletagmanager|gtag\(|plausible|umami|clarity|matomo/i) ? "Analytics script found" : "No analytics script found",
      taskCodes: ["AJ-02"],
    },
    { id: "lang", label: "Language and landmarks", ok: has(h, /<html[^>]+lang=/i) && has(h, /<main[\s>]/i), detail: `${has(h, /<html[^>]+lang=/i) ? "lang set" : "no lang attribute"}, ${has(h, /<main[\s>]/i) ? "main landmark" : "no <main>"}`, taskCodes: ["AK-02"] },
    { id: "alt", label: "Image alt text", ok: noAlt === 0, detail: noAlt ? `${noAlt} image(s) without alt text` : `${imgs.length} image(s), all with alt`, taskCodes: ["AK-04"] },
    { id: "viewport", label: "Mobile viewport", ok: has(h, /<meta[^>]+name=["']viewport["']/i), detail: has(h, /name=["']viewport/i) ? "Viewport meta present" : "No viewport meta", taskCodes: [] },
    { id: "privacy", label: "Privacy notice linked", ok: has(h, /href=["'][^"']*privacy/i), detail: has(h, /href=["'][^"']*privacy/i) ? "Link to a privacy page found" : "No privacy link on the page", taskCodes: ["BK-01"] },
    {
      id: "not_found",
      label: "Real 404 page",
      ok: s.notFoundStatus === 404,
      detail: s.notFoundStatus === null ? "Not tested" : `A missing page returned HTTP ${s.notFoundStatus}`,
      taskCodes: [],
    },
  ];
  return checks;
}
