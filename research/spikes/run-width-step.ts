/** Spike 2b runner. Needs `pnpm dev --port 5199` running. */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5199/research/spikes/width-step.html');
await page.waitForFunction(() => (window as any).__results, null, { timeout: 30000 });
for (const row of await page.evaluate(() => (window as any).__results)) console.log(JSON.stringify(row));
await browser.close();
