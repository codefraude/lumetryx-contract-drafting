import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a running server (`npm run build && npm start`,
 * or `npm run dev`). E2E_BROWSERS picks the engines (default
 * "chromium"; e.g. "chromium,firefox,webkit"). CHROMIUM_PATH and
 * WEBKIT_PATH point at other executables when Playwright's own
 * download is unavailable or cannot load its system libraries.
 */
const viewport = {
  width: 1400,
  height: 900,
};
const browsers = (process.env.E2E_BROWSERS ?? "chromium")
  .split(",")
  .map((b) => b.trim());

const executable = (path: string | undefined, args: string[] = []) => {
  return path
    ? {
        launchOptions: {
          executablePath: path,
          args,
        },
      }
    : {};
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "tests/output/playwright",
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    acceptDownloads: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        ...executable(process.env.CHROMIUM_PATH, [
          "--no-sandbox",
          "--disable-gpu",
          "--use-gl=swiftshader",
        ]),
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport,
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport,
        ...executable(process.env.WEBKIT_PATH),
      },
    },
  ].filter((p) => browsers.includes(p.name)),
});
