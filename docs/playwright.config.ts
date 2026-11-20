import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "bun run dev";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  globalSetup: "./e2e/helpers/global-setup.ts",
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  retries: process.env.CI ? 2 : 0,
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts", "**/*.test.ts"],
  // Has to exceed `navigationTimeout`, or the test is cut short before a slow
  // navigation can report its own failure.
  timeout: 90_000,
  use: {
    baseURL,
    colorScheme: "light",
    extraHTTPHeaders: {
      "x-test-mode": "true",
    },
    // `page.goto` resolves on `load`, which waits for every subresource. The
    // marketing pages pull several megabytes of hero video and imagery off the
    // CDN, and 30s was not enough for that to settle — navigation timed out
    // before a single assertion ran.
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
  workers: process.env.CI ? 1 : undefined,
});
