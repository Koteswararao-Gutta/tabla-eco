import { defineConfig } from '@playwright/test';

// Each agent uses its own PW_PORT (see CLAUDE.md) so parallel test runs never share a server.
const port = Number(process.env.PW_PORT || 4173);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 720 },
    // Set PW_CHROMIUM to use an already-installed Chromium instead of Playwright's download.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: `npx vite build && npx vite preview --port ${port} --strictPort`, port, reuseExistingServer: false, timeout: 120_000 },
});
