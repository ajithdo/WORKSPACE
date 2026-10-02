import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  // The app reads DATA_DIR, migrations and the seed library from disk at runtime, which makes file
  // tracing pull in the whole project. Keep the standalone output to what the server needs; the
  // postbuild step and the Dockerfile add drizzle/ and seed/ explicitly. Never ship a data folder.
  outputFileTracingExcludes: {
    "*": ["./data/**", "./demo-data/**", "./.e2e-data/**", "./docs/**", "./tests/**", "./test-results/**", "./playwright-report/**", "./scripts/**", "./src/**", "./drizzle/**", "./seed/**", "./*.md", "./Dockerfile", "./docker-compose.yml", "./.env*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
