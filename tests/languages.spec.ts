import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
async function settled(page: Page) {
  await expect(page.locator('#status-message')).toContainText('Composition settled', { timeout: 15000 });
  await expect(page.locator('#export')).toBeEnabled();
}

for (const lang of ['en', 'ja', 'ar']) for (const width of [375, 1440]) {
  test(`${lang} at ${width}: fonts, direction, geometry and native clipboard`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width, height: 1100 });
    await page.goto('/');
    if (width < 760) await page.locator('#mobile-controls-toggle').click();
    await page.locator('#language').selectOption(lang);
    await settled(page);
    const geometry = await page.evaluate(() => {
      const data = (window as any).__composition;
      const models = data.result.paragraphs.flatMap((p: any) => p.lines);
      return {
        error: Math.max(...[...document.querySelectorAll('.composed-line')].map((el, i) => Math.abs(el.querySelector('.line-text')!.getBoundingClientRect().width - models[i].width))),
        overflow: document.documentElement.scrollWidth > innerWidth,
        maxTracking: Math.max(...models.map((l: any) => Math.abs(l.tracking))),
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.error).toBeLessThan(lang === 'ja' ? .5 : .3);
    await expect(page.locator('#optimized p').first()).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    if (lang === 'ar') {
      expect(geometry.maxTracking).toBe(0);
      await expect(page.locator('#tracking-min')).toBeDisabled();
    }
    if (lang !== 'en') {
      const supported = await page.locator('#typeface option:not([hidden])').evaluateAll(els => els.map(el => (el as HTMLOptionElement).value));
      expect(supported).toEqual([lang === 'ja' ? 'japanese' : 'arabic']);
    }
    await page.locator('#visualizers').check();
    const expected = await page.locator('#baseline p').allTextContents();
    await page.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('#optimized')!);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.press('ControlOrMeta+c');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(expected.join('\n\n'));
    await page.locator('#direction').selectOption(lang === 'ar' ? 'ltr' : 'rtl');
    await settled(page);
    await expect(page.locator('#optimized p').first()).toHaveAttribute('dir', lang === 'ar' ? 'ltr' : 'rtl');
    await page.locator('#direction').selectOption('auto');
    await settled(page);
    if (width === 1440 && lang !== 'en') await page.locator('.previews').screenshot({ path: `/tmp/unjustified-${lang}-previews.png` });
  });
}

test('native partial copy preserves sentences and real paragraph boundaries', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/'); await settled(page);
  const expected = await page.evaluate(() => {
    // Composed lines hold plain text unless word highlighting is on, so walk to
    // the first/last text node instead of assuming per-word spans.
    const walk = (node: Node | null, edge: 'first' | 'last'): Node => {
      let current = node!;
      while (current.nodeType !== Node.TEXT_NODE) {
        const next = edge === 'first' ? current.firstChild : current.lastChild;
        if (!next) break;
        current = next;
      }
      return current;
    };
    const ps = document.querySelectorAll('#optimized p');
    const start = walk(ps[0].querySelectorAll('.line-text')[1].firstChild, 'first');
    const end = walk(ps[1].querySelectorAll('.line-text')[2].lastChild, 'last');
    const range = document.createRange(); range.setStart(start, 1); range.setEnd(end, 2);
    const first = document.createRange(); first.selectNodeContents(ps[0]); first.setStart(start, 1);
    const second = document.createRange(); second.selectNodeContents(ps[1]); second.setEnd(end, 2);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    return `${first.toString()}\n\n${second.toString()}`;
  });
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
});

test('benchmark measures the full pipeline and reuses Canvas measurements', async ({ page }) => {
  await page.goto('/'); await settled(page);
  await expect(page.locator('#benchmark-total')).toContainText('ms');
  await page.locator('#benchmark-run').click();
  await expect(page.locator('#benchmark-result')).toContainText('cached median', { timeout: 15000 });
  const data = await page.evaluate(() => (window as any).__benchmark);
  expect(data.warm).toHaveLength(5);
  expect(data.cold.measurements).toBeGreaterThan(0);
  expect(data.warm.every((run: any) => run.measurements === 0)).toBe(true);
  for (const run of [data.cold, ...data.warm]) {
    expect(run.totalMs).toBeGreaterThanOrEqual(run.searchMs + run.measureMs);
    expect(run.totalMs).toBeGreaterThan(0);
  }
  console.log(JSON.stringify({ cold: data.cold, cached: data.warm.map((r: any) => ({ total: r.totalMs, search: r.searchMs })) }));
});
