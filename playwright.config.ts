import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a running server (`npm run build && npm start`, or `npm run dev`).
 * CHROMIUM_PATH lets you point at any Chromium when Playwright's own download is unavailable.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "tests/output/playwright",
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    acceptDownloads: true,
    ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"] } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
});
