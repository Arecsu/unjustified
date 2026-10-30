/**
 * Battle tests: the cases a real deployment hits that the playground never does.
 *
 * A 35-paragraph article (~11,000 characters) is loaded through the editor and
 * exercised for correctness, DOM budget, resize behaviour, cache reuse and copy
 * integrity. Thresholds are deliberately loose enough for slow CI machines but
 * tight enough to catch a regression to the pre-optimization behaviour (which
 * took ~1 s to compose and re-rendered ~3,500 nodes per resize).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeParagraphs } from '../bench/corpus';
import { samples } from '../src/samples';

const article = makeParagraphs(35, 424242);
const source = article.join('\n\n');
const normalize = (text: string) => text.replace(/[\t\n\r\f ]+/g, ' ').trim();

async function settled(page: Page, timeout = 30000) {
  await expect(page.locator('#status-message')).toContainText(/Composition settled|Widen the column/, { timeout });
  await expect(page.locator('#export')).toBeEnabled({ timeout });
}

async function loadArticle(page: Page) {
  await page.goto('/');
  await settled(page);
  await page.locator('#edit-text').click();
  await page.locator('#text-editor').fill(source);
  await page.locator('#apply-text').click();
  await settled(page);
}

type Report = {
  paragraphs: number;
  lines: number;
  elements: number;
  measuredWidth: number;
  columnWidth: number;
  scrollWidth: number;
  viewport: number;
  maxWidthError: number;
  textsMatch: boolean;
  trackingInBounds: boolean;
  elapsed: number;
  measurements: number;
  resultLines: number;
};

async function report(page: Page): Promise<Report> {
  return page.evaluate(() => {
    const data = (window as any).__composition;
    const result = data.result;
    const lines = result.paragraphs.flatMap((p: any) => p.lines);
    const column = document.querySelector<HTMLElement>('#optimized')!;
    const rendered = [...column.querySelectorAll<HTMLElement>('.composed-line')];
    const tracking = data.settings;
    return {
      paragraphs: result.paragraphs.length,
      lines: lines.length,
      resultLines: rendered.length,
      elements: column.querySelectorAll('*').length,
      measuredWidth: data.settings.width,
      columnWidth: column.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      maxWidthError: Math.max(...rendered.map((el, i) => Math.abs(
        el.querySelector('.line-text')!.getBoundingClientRect().width - lines[i].width))),
      textsMatch: [...column.querySelectorAll('p')].every((p, i) =>
        (p.textContent ?? '').replace(/\s+/gu, ' ').trim()
          === ((window as any).__composition.result.paragraphs[i] ? p.textContent ?? '' : '').replace(/\s+/gu, ' ').trim()),
      trackingInBounds: lines.every((line: any) =>
        line.tracking >= tracking.trackingMin - 1e-9 && line.tracking <= tracking.trackingMax + 1e-9),
      elapsed: data.elapsed,
      measurements: data.measurements,
    };
  });
}

test('a 35-paragraph article composes accurately without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadArticle(page);
  const data = await report(page);
  expect(data.paragraphs).toBe(35);
  expect(data.resultLines).toBe(data.lines);
  expect(data.scrollWidth).toBeLessThanOrEqual(data.viewport);
  expect(Math.abs(data.measuredWidth - data.columnWidth)).toBeLessThan(1.1);
  // Word spans and glyph advances are quantized to browser layout units.
  expect(data.maxWidthError).toBeLessThan(0.3);
  expect(data.trackingInBounds).toBe(true);
  // Every word survives composition, in order, and each paragraph still ends
  // with its real separator.
  const preserved = await page.evaluate(() => {
    const paragraphs = [...document.querySelectorAll('#optimized p')];
    return paragraphs.map(p => (p.textContent ?? '').replace(/\s+/gu, ' ').trim());
  });
  expect(preserved).toEqual(article.map(normalize));
  // DOM budget: one inline block per line, not one span per word.
  expect(data.elements).toBeLessThan(data.lines * 3 + 200);
});

test('a warm recomposition reuses measurements and settles quickly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadArticle(page);
  const first = await report(page);
  expect(first.measurements).toBeGreaterThan(0);

  const timing = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('#rag')!;
    const started = performance.now();
    input.value = '70';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>(resolve => {
      const check = () => document.querySelector('#status')!.classList.contains('is-busy')
        ? requestAnimationFrame(check) : resolve();
      check();
    });
    const data = (window as any).__composition;
    return { wall: performance.now() - started, measurements: data.measurements, elapsed: data.elapsed };
  });
  // Canvas measurements are cached by string; a re-rank of the same text needs none.
  expect(timing.measurements).toBe(0);
  expect(timing.elapsed).toBeLessThan(400);
  expect(timing.wall).toBeLessThan(1200);
  await settled(page);
});

test('resize bursts stay interactive and never leave a stale measure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadArticle(page);
  await page.evaluate(() => {
    (window as any).__long = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) (window as any).__long.push(entry.duration);
    }).observe({ type: 'longtask' });
    (window as any).__frames = [];
    let last = performance.now();
    (window as any).__tick = (t: number) => {
      (window as any).__frames.push(t - last);
      last = t;
      requestAnimationFrame((window as any).__tick);
    };
    requestAnimationFrame((window as any).__tick);
  });
  for (const width of [1200, 900, 768, 600, 390, 320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(80);
  }
  await settled(page);
  const stats = await page.evaluate(() => {
    const frames = (window as any).__frames as number[];
    const long = (window as any).__long as number[];
    const column = document.querySelector<HTMLElement>('#optimized')!;
    return {
      frames: frames.length,
      worstFrame: Math.max(...frames),
      longTasks: long.length,
      worstLongTask: long.length ? Math.max(...long) : 0,
      measured: (window as any).__composition.settings.width,
      width: column.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
    };
  });
  expect(Math.abs(stats.measured - stats.width)).toBeLessThan(1.1);
  expect(stats.scrollWidth).toBeLessThanOrEqual(stats.viewport);
  // The search runs in a worker and the DOM commit is a single write: the main
  // thread should never be blocked for long while resizing a 35-paragraph post.
  expect(stats.longTasks).toBeLessThanOrEqual(1);
  expect(stats.worstLongTask).toBeLessThan(250);
});

test('word highlighting is opt-in and does not change the text', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await loadArticle(page);
  const plain = await report(page);
  const textBefore = await page.evaluate(() => document.querySelector('#optimized')!.textContent);
  await page.locator('#changes').check();
  const highlighted = await report(page);
  expect(highlighted.elements).toBeGreaterThan(plain.elements);
  await expect(page.locator('#optimized .moved-word').first()).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('#optimized')!.textContent)).toBe(textBefore);
  await page.locator('#changes').uncheck();
  const restored = await report(page);
  expect(restored.elements).toBe(plain.elements);
  expect(restored.lines).toBe(plain.lines);
});

test('composition is deterministic for identical input and settings', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await loadArticle(page);
  const signature = () => page.evaluate(() => {
    const result = (window as any).__composition.result;
    return JSON.stringify(result.paragraphs.map((p: any) => p.lines.map((l: any) => [l.start, l.end, l.text, l.tracking])));
  });
  const first = await signature();
  await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('#rag')!;
    const value = input.value;
    input.value = String(Number(value) + 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>(resolve => {
      const check = () => document.querySelector('#status')!.classList.contains('is-busy')
        ? requestAnimationFrame(check) : resolve();
      check();
    });
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>(resolve => {
      const check = () => document.querySelector('#status')!.classList.contains('is-busy')
        ? requestAnimationFrame(check) : resolve();
      check();
    });
  });
  await settled(page);
  expect(await signature()).toBe(first);
});

test('diagnostics overlay a long article without changing its geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadArticle(page);
  const before = await page.evaluate(() => {
    const el = document.querySelector('#optimized')!;
    return { text: el.textContent, height: el.getBoundingClientRect().height };
  });
  await page.locator('#visualizers').check();
  await expect(page.locator('.composition-overlay')).toHaveCount(2);
  const after = await page.evaluate(() => {
    const el = document.querySelector('#optimized')!;
    return { text: el.textContent, height: el.getBoundingClientRect().height };
  });
  expect(after).toEqual(before);
});

test('copying a long article keeps every paragraph boundary', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadArticle(page);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#optimized')!);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+c');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(normalize(copied)).toBe(normalize(source));
});

/** A long non-Latin document, built by repeating the sample article body. */
const longDocument = (sample: string, paragraphs: number) => {
  const base = sample.split('\n\n');
  return Array.from({ length: paragraphs }, (_, i) => base[i % base.length]).join('\n\n');
};

for (const [name, sample, expectedLang] of [
  ['Japanese', samples.japanese, 'ja'],
  ['Arabic', samples.arabic, 'ar'],
] as const) {
  test(`a 20-paragraph ${name} article breaks without overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto('/');
    await settled(page);
    const text = longDocument(sample, 20);
    await page.locator('#edit-text').click();
    await page.locator('#text-editor').fill(text);
    await page.locator('#apply-text').click();
    await settled(page);
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settled(page);
      const data = await page.evaluate(() => {
        const result = (window as any).__composition.result;
        const lines = result.paragraphs.flatMap((p: any) => p.lines);
        const column = document.querySelector<HTMLElement>('#optimized')!;
        const rendered = [...column.querySelectorAll<HTMLElement>('.composed-line')];
        return {
          paragraphs: result.paragraphs.length,
          overflow: document.documentElement.scrollWidth > innerWidth,
          anyOverflowLine: lines.some((l: any) => l.overflow),
          error: Math.max(...rendered.map((el, i) => Math.abs(
            el.querySelector('.line-text')!.getBoundingClientRect().width - lines[i].width))),
          maxTracking: Math.max(...lines.map((l: any) => Math.abs(l.tracking))),
          lang: (document.querySelector('#optimized p') as HTMLElement).lang,
        };
      });
      expect(data.paragraphs).toBe(20);
      expect(data.lang).toBe(expectedLang);
      expect(data.overflow).toBe(false);
      expect(data.anyOverflowLine).toBe(false);
      expect(data.error).toBeLessThan(0.5);
      // Arabic keeps connected shaping: tracking stays at exactly zero.
      if (expectedLang === 'ar') expect(data.maxTracking).toBe(0);
    }
  });
}

test('helper workers start only for long documents', async ({ page }) => {
  const started = () => page.evaluate(() => ((window as any).__worker?.log ?? []).includes('helpers-started'));
  await page.goto('/');
  await settled(page);
  expect(await started()).toBe(false);
  await page.locator('#edit-text').click();
  await page.locator('#text-editor').fill(source);
  await page.locator('#apply-text').click();
  await settled(page);
  expect(await started()).toBe(true);
});
