import { defineConfig, devices } from "@playwright/test";

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
