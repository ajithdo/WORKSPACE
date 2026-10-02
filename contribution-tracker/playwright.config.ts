import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);
// E2E_PROD=1 runs against the production build (`npm run build` first), which is what Docker ships.
const PROD = process.env.E2E_PROD === "1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
  },
  webServer: {
    // A throwaway data folder so the test always starts at the setup wizard.
    command: PROD ? `rm -rf .e2e-data && DATA_DIR=.e2e-data PORT=${PORT} node scripts/start.mjs` : `rm -rf .e2e-data && DATA_DIR=.e2e-data npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
