import { defineConfig } from '@playwright/test';

// Each agent uses its own PW_PORT (see CLAUDE.md) so parallel test runs never share a server.
const port = Number(process.env.PW_PORT || 4173);
// Tests run on the restaurant's time zone, in the browser (timezoneId below) and in the test code.
process.env.TZ = 'America/Phoenix';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 720 },
    // The restaurant's time zone; screens warn when a device is set to another one.
    timezoneId: 'America/Phoenix',
    // Set PW_CHROMIUM to use an already-installed Chromium instead of Playwright's download.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: `VITE_STORE=local npx vite build && npx vite preview --port ${port} --strictPort`, port, reuseExistingServer: false, timeout: 120_000 },
});
