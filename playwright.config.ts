import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: true, workers: 2,
  use: { baseURL: 'http://127.0.0.1:4179', headless: true },
  webServer: { command: 'node scripts/fixture-server.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: false, timeout: 30000 },
});
