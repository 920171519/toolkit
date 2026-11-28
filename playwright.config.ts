import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.TOOLKIT_QA_PORT ?? "3100");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("TOOLKIT_QA_PORT 必须是有效的端口号。");
}
const baseURL = `http://127.0.0.1:${port}`;
const runDirectory = join(tmpdir(), `toolkit-e2e-${randomUUID()}`);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: join(__dirname, "tests", "e2e", "setup.ts"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    testIdAttribute: "data-testid",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    env: {
      DATABASE_PATH: join(runDirectory, "toolkit.db"),
      TOOLKIT_REPORTS_PATH: join(runDirectory, "reports"),
      // Ignore local overrides while exercising protocol detection.
      SESSION_COOKIE_SECURE: "",
      TOOLKIT_SKIP_SEED: "0",
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
