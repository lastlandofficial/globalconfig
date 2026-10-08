import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:4179",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  ...(process.env.GLOCON_BROWSER_MATRIX === "1"
    ? {
        projects: ["chromium", "firefox", "webkit"].map((browserName) => ({
          name: browserName,
          testMatch: "**/browser.spec.ts",
          testIgnore: [],
          grepInvert: /CLI|published CLI/,
          use: {
            browserName: browserName as "chromium" | "firefox" | "webkit",
          },
        })),
      }
    : {}),
  webServer: {
    command: "node scripts/fixture-server.mjs",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
