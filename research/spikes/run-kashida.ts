/**
 * Spike 1. Prints, per browser and word, whether mechanisms (b) span and
 * (c) ::before render identically to (a) plain tatweel text — same width and
 * same pixels means the joins were kept — and what a selection of each
 * contains. Needs `pnpm dev --port 5199` running.
 */
import { chromium, webkit, firefox } from '@playwright/test';

const url = 'http://127.0.0.1:5199/research/spikes/kashida.html';
const browsers = [
  ['chrome', () => chromium.launch({ channel: 'chrome' })],
  ['webkit', () => webkit.launch()],
  ['firefox', () => firefox.launch()],
] as const;

for (const [name, launch] of browsers) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready);
  for (let i = 0; i < 3; i++) {
    const plain = page.locator(`#plain-${i}`);
    const plainBox = (await plain.boundingBox())!;
    const plainShot = await plain.screenshot();
    const original = await page.locator(`#original-${i}`).textContent();
    for (const mechanism of ['span', 'before'] as const) {
      const el = page.locator(`#${mechanism}-${i}`);
      const box = (await el.boundingBox())!;
      const samePixels = Buffer.compare(await el.screenshot(), plainShot) === 0;
      const selected = await el.evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      });
      console.log(JSON.stringify({
        browser: name, word: i, mechanism,
        widthDelta: +(box.width - plainBox.width).toFixed(3),
        samePixels,
        cleanSelection: selected === original,
        selected,
      }));
    }
  }
  if (name === 'chrome') {
    const context = page.context();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    for (const mechanism of ['span', 'before'] as const) {
      await page.locator(`#${mechanism}-0`).evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
      });
      await page.keyboard.press('ControlOrMeta+c');
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      console.log(JSON.stringify({ browser: name, mechanism, clipboard: copied, clean: copied === 'مستشفى' }));
    }
  }
  await browser.close();
}
