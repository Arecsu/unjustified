import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function settled(page: Page) {
  await expect(page.locator('#status-message')).toContainText('Composition settled');
  await expect(page.locator('#export')).toBeEnabled();
}
async function setRange(page: Page, id: string, value: number) {
  await page.locator(`#${id}`).evaluate((el, n) => {
    (el as HTMLInputElement).value = String(n);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await settled(page);
}

for (const width of [320, 375, 600, 768, 1024, 1440]) {
  test(`recomposes accurately without horizontal overflow at ${width}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await settled(page);
    const dimensions = await page.evaluate(() => {
      const base = document.querySelector<HTMLElement>('#baseline')!;
      const opt = document.querySelector<HTMLElement>('#optimized')!;
      const data = (window as any).__composition;
      const lines = data.result.paragraphs.flatMap((p: any) => p.lines);
      const actualLines = [...opt.querySelectorAll<HTMLElement>('.composed-line')];
      return {
        scroll: document.documentElement.scrollWidth,
        viewport: innerWidth,
        baseline: base.getBoundingClientRect().width,
        optimized: opt.getBoundingClientRect().width,
        baseMargins: [...base.querySelectorAll('p')].map(p => getComputedStyle(p).marginBottom),
        optMargins: [...opt.querySelectorAll('p')].map(p => getComputedStyle(p).marginBottom),
        maxError: Math.max(...actualLines.map((el, i) => Math.abs(el.querySelector('.line-text')!.getBoundingClientRect().width - lines[i].width))),
        maxExcess: Math.max(...actualLines.map(el => el.querySelector('.line-text')!.getBoundingClientRect().width - opt.getBoundingClientRect().width)),
        paragraphs: opt.querySelectorAll('p').length,
        elapsed: data.elapsed,
      };
    });
    expect(errors).toEqual([]);
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.baseline).toBeCloseTo(dimensions.optimized, 1);
    expect(dimensions.optMargins).toEqual(dimensions.baseMargins);
    // Inline word spans and glyph advances are quantized to browser layout units.
    expect(dimensions.maxError).toBeLessThan(0.25);
    expect(dimensions.maxExcess).toBeLessThanOrEqual(0.15);
    expect(dimensions.paragraphs).toBe(3);
    console.log(`${width}: ${dimensions.optimized.toFixed(1)} CSS px measure, ${dimensions.elapsed.toFixed(1)} ms worker, ${dimensions.maxError.toFixed(3)} px max width error`);
    if (width === 375 || width === 1440) {
      await page.screenshot({ path: `/tmp/unjustified-${width}.png`, fullPage: true });
    }
  });
}

test('mobile controls disclose, sliders recompose, and inspection works', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/');
  await settled(page);
  await expect(page.locator('#font-size')).not.toBeVisible();
  await page.locator('#mobile-controls-toggle').click();
  await expect(page.locator('#mobile-controls-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#font-size')).toBeVisible();
  await setRange(page, 'tracking-min', 0);
  await setRange(page, 'tracking-max', 0);
  await expect(page.locator('#tracking-stat')).toHaveText('±0.0000 em');
  await page.locator('#guides').check();
  await page.locator('#changes').check();
  await page.locator('#inspect').check();
  await page.locator('#optimized .composed-line').first().click();
  await expect(page.locator('#line-inspector')).toContainText('LINE 1');
  await page.locator('[data-view="focus"]').click();
  await settled(page);
  await expect(page.locator('.baseline-paper')).not.toBeVisible();
  await page.locator('[data-view="compare"]').click();
  await settled(page);
  await expect(page.locator('.baseline-paper')).toBeVisible();
});

test('rapid viewport changes discard stale work and both measures stay equal', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  for (const width of [1024, 375, 1440, 600, 320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
  }
  await settled(page);
  await expect.poll(async () => page.evaluate(() => Math.abs(
    (window as any).__composition.settings.width - document.querySelector('#optimized')!.getBoundingClientRect().width,
  ))).toBeLessThan(1.1);
  await expect(page.locator('#status')).not.toHaveClass(/is-busy/);
});

test('editor validates, escapes markup, and reports impossible words', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await page.locator('#edit-text').click();
  await page.locator('#text-editor').fill('');
  await page.locator('#apply-text').click();
  await expect(page.locator('#editor-error')).toContainText('1–8 paragraphs');
  await page.locator('#text-editor').fill('A literal <img src=x onerror=alert(1)> is plain text.\n\nA second paragraph with enough text to occupy a couple of lines comfortably.');
  await page.locator('#apply-text').click();
  await settled(page);
  await expect(page.locator('#optimized img')).toHaveCount(0);
  await expect(page.locator('#optimized p')).toHaveCount(2);
  await page.locator('#edit-text').click();
  await page.locator('#text-editor').fill('W'.repeat(160));
  await page.locator('#apply-text').click();
  await expect(page.locator('#status-message')).toContainText('unbreakable word');
  await expect(page.locator('.overflowing')).toHaveCount(1);
});

test('font changes, reset, and snapshot export work', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await page.locator('#typeface').selectOption('sans');
  await expect.poll(() => page.locator('#optimized').evaluate(el => getComputedStyle(el).fontFamily)).toContain('DM Sans');
  await settled(page);
  await setRange(page, 'font-size', 22);
  await page.locator('#reset').click();
  await settled(page);
  await expect(page.locator('#font-size')).toHaveValue('19');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('unjustified.html');
});


test('composition diagnostics overlay text without blaming normal whitespace', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  const before = await page.locator('#optimized').evaluate(el => ({ text: el.textContent, height: el.getBoundingClientRect().height }));
  await page.locator('#visualizers').check();
  await expect(page.locator('.composition-overlay')).toHaveCount(2);
  expect(await page.locator('.diagnostic-mark.endpoint').count()).toBeGreaterThan(0);
  expect(await page.locator('.diagnostic-mark.tracking').count()).toBeGreaterThan(0);
  await expect(page.locator('.red-mark')).toHaveCount(0);
  const after = await page.locator('#optimized').evaluate(el => ({ text: el.textContent, height: el.getBoundingClientRect().height }));
  expect(after).toEqual(before);
  await expect(page.locator('[data-view="difference"]')).toHaveCount(0);
  await page.locator('#visualizers').uncheck();
  await expect(page.locator('.composition-overlay')).toHaveCount(0);
});

test('the two tracking handles allow independent negative and positive bounds', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await setRange(page, 'tracking-min', -0.025);
  await setRange(page, 'tracking-max', 0.004);
  await expect(page.locator('#tracking-min-value')).toHaveText('−0.025 em');
  await expect(page.locator('#tracking-max-value')).toHaveText('+0.004 em');
  const bounded = await page.evaluate(() => (window as any).__composition.result.paragraphs
    .flatMap((p: any) => p.lines).every((l: any) => l.tracking >= -.025 && l.tracking <= .004));
  expect(bounded).toBe(true);
  await page.locator('#tracking-min').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tracking-min')).toHaveValue('-0.024');
  await settled(page);
  await page.locator('#reset').click();
  await settled(page);
  await expect(page.locator('#tracking-min')).toHaveValue('-0.012');
  await expect(page.locator('#tracking-max')).toHaveValue('0.012');
});
