import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5201' },
  webServer: {
    command: 'pnpm preview --port 5201 --strictPort',
    url: 'http://127.0.0.1:5201',
    reuseExistingServer: !process.env.CI,
  },
});
