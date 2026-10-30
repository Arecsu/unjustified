import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' }, testIgnore: /firefox-/ },
    // Firefox's clipboard serializer differs from Chrome's; read the real clipboard.
    { name: 'firefox', testMatch: /firefox-/, use: { browserName: 'firefox', launchOptions: {
      firefoxUserPrefs: { 'dom.events.asyncClipboard.readText': true, 'dom.events.testing.asyncClipboard': true },
    } } },
  ],
  webServer: {
    command: 'pnpm dev --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
  },
});
