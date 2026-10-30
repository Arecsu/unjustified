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

test('column width changes real geometry with keyboard and pointer input', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  const slider = page.locator('#measure');
  const expectWidth = async (width: number) => {
    await settled(page);
    await expect.poll(() => page.evaluate(() => ({
      baseline: document.querySelector('#baseline')!.getBoundingClientRect().width,
      optimized: document.querySelector('#optimized')!.getBoundingClientRect().width,
      composed: (window as any).__composition.settings.width,
    }))).toEqual({ baseline: width, optimized: width, composed: width });
  };
  await slider.focus();
  await slider.press('Home');
  await expectWidth(240);
  await slider.press('ArrowRight');
  await expectWidth(242);
  const box = (await slider.boundingBox())!;
  await slider.click({ position: { x: box.width * .25, y: box.height / 2 } });
  const requested = Number(await slider.inputValue());
  expect(requested).toBeGreaterThan(242);
  await expectWidth(requested);
});

for (const replyDelay of [0, 45]) {
  test(`continuous width input keeps painting while dragging (${replyDelay}ms worker latency)`, async ({ page }) => {
    if (replyDelay) {
      await page.route(/\/composer\.worker[^/]*\.(?:ts|js)(?:\?|$)/, async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `
          const post = self.postMessage.bind(self);
          self.postMessage = message => 'id' in message
            ? setTimeout(() => post(message), ${replyDelay}) : post(message);
          ${await response.text()}
        ` });
      });
    }
    await page.goto('/');
    await settled(page);
    const progress = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('#measure')!;
      let previous = (window as any).__composition;
      const widths: number[] = [], commits: number[] = [];
      const started = performance.now();
      for (let frame = 0; frame < 48; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const data = (window as any).__composition;
        if (data !== previous) {
          previous = data;
          widths.push(data.settings.width);
          commits.push(performance.now() - started);
        }
        input.value = String(270 + frame * 2);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { widths, commits, duration: performance.now() - started };
    });
    console.log(`live drag (${replyDelay}ms latency): ${progress.commits.length} commits over ${Math.round(progress.duration)}ms`);
    // Check intermediate results, not merely the final width after pointer-up.
    // The slow-worker case also catches continually rejecting superseded work.
    expect(progress.commits.length).toBeGreaterThan(replyDelay ? 4 : 12);
    expect(new Set(progress.widths).size).toBe(progress.widths.length);
    expect(progress.commits[0]).toBeLessThan(200);
    await settled(page);
    await expect.poll(() => page.evaluate(() => (window as any).__composition.settings.width)).toBe(364);
    await expect(page.locator('#status')).not.toHaveClass(/is-busy/);
  });
}

test('every composition slider sends its new setting to the engine', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  for (const [id, key, value] of [
    ['font-size', 'fontSize', 20],
    ['tracking-min', 'trackingMin', -.011],
    ['tracking-max', 'trackingMax', .013],
    ['rag', 'rag', .06],
    ['sync', 'sync', .70],
    ['ending', 'minEnding', .33],
  ] as const) {
    await page.locator(`#${id}`).press('ArrowRight');
    await settled(page);
    await expect.poll(() => page.evaluate(key => (window as any).__composition.settings[key], key)).toBeCloseTo(value, 8);
  }
});

test('slow module evaluation does not lose the first worker messages', async ({ page }) => {
  await page.route(/\/composer\.worker[^/]*\.(?:ts|js)(?:\?|$)/, async route => {
    const response = await route.fetch();
    // Model an async dev-server import: the worker event loop is running but
    // the module has not installed its message handler yet.
    await route.fulfill({ response, body: `await new Promise(resolve => setTimeout(resolve, 500));\n${await response.text()}` });
  });
  await page.goto('/');
  await settled(page);
  expect(await page.evaluate(() => {
    const state = (window as any).__worker;
    return { booted: state.booted, ready: state.ready, dead: state.dead, fallback: state.fallback };
  })).toEqual({ booted: true, ready: true, dead: false, fallback: false });
  await setRange(page, 'measure', 300);
  await expect.poll(() => page.evaluate(() => (window as any).__composition.settings.width)).toBe(300);
});

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
  await expect(page.locator('#editor-error')).toContainText('1–60 paragraphs');
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

test('full edge firmness pulls body lines nearly flush without overflowing', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  const bodyFills = () => page.evaluate(() => (window as any).__composition.result.paragraphs
    .flatMap((p: any) => p.lines.slice(0, -1).map((l: any) => l.fill)) as number[]);
  await setRange(page, 'rag', 0);
  await setRange(page, 'tracking-min', -0.08);
  await setRange(page, 'tracking-max', 0.08);
  const ragged = Math.min(...await bodyFills());
  await setRange(page, 'firmness', 100);
  await expect(page.locator('#firmness-value')).toHaveText('100%');
  const fills = await bodyFills();
  expect(Math.min(...fills)).toBeGreaterThan(Math.max(ragged, 0.97));
  // Rendered text must not cross the column edge, not merely the model's.
  const spill = await page.evaluate(() => {
    const column = document.querySelector('#optimized')!.getBoundingClientRect();
    return Math.max(...[...document.querySelectorAll('#optimized .line-text')]
      .map(el => el.getBoundingClientRect().right - column.right));
  });
  expect(spill).toBeLessThan(0.5);
});

test('word spacing flex evens Arabic lines with tracking locked at zero', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('#language').selectOption('ar');
  await settled(page);
  const bodyFills = () => page.evaluate(() => (window as any).__composition.result.paragraphs
    .flatMap((p: any) => p.lines.slice(0, -1).map((l: any) => l.fill)) as number[]);
  await setRange(page, 'rag', 0);
  await setRange(page, 'firmness', 100);
  const ragged = Math.min(...await bodyFills());
  await setRange(page, 'word-spacing', 50);
  await expect(page.locator('#word-spacing-value')).toHaveText('50%');
  // Arabic lines have few spaces, so 50 % flex narrows the rag rather than
  // closing it; the shortest body line must still get longer.
  expect(Math.min(...await bodyFills())).toBeGreaterThan(ragged);
  const geometry = await page.evaluate(() => {
    const models = (window as any).__composition.result.paragraphs.flatMap((p: any) => p.lines);
    const rendered = [...document.querySelectorAll('#optimized .composed-line')];
    const column = document.querySelector('#optimized')!.getBoundingClientRect();
    return {
      error: Math.max(...rendered.map((el, i) => Math.abs(el.querySelector('.line-text')!.getBoundingClientRect().width - models[i].width))),
      spill: Math.max(...rendered.map(el => column.left - el.querySelector('.line-text')!.getBoundingClientRect().left)),
      tracking: Math.max(...models.map((l: any) => Math.abs(l.tracking))),
      spaced: models.some((l: any) => l.wordSpacing !== 0),
    };
  });
  expect(geometry.error).toBeLessThan(0.3);
  // RTL: lines grow leftwards, so spill shows as text left of the column.
  expect(geometry.spill).toBeLessThan(0.5);
  expect(geometry.tracking).toBe(0);
  expect(geometry.spaced).toBe(true);
  // Native copy is still the original text.
  const expected = await page.locator('#baseline p').allTextContents();
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#optimized')!);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected.join('\n\n'));
});

test('word spacing flex is disabled for all-Japanese text', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await expect(page.locator('#word-spacing')).toBeEnabled();
  await page.locator('#language').selectOption('ja');
  await settled(page);
  await expect(page.locator('#word-spacing')).toBeDisabled();
  await expect(page.locator('#word-spacing-note')).toContainText('no word spaces');
});

test('kashida stretches Arabic joins without changing the copied text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('#language').selectOption('ar');
  await settled(page);
  await expect(page.locator('#kashida')).toBeEnabled();
  const bodyFills = () => page.evaluate(() => (window as any).__composition.result.paragraphs
    .flatMap((p: any) => p.lines.slice(0, -1).map((l: any) => l.fill)) as number[]);
  await setRange(page, 'rag', 0);
  await setRange(page, 'firmness', 100);
  const ragged = Math.min(...await bodyFills());
  await setRange(page, 'kashida', 4);
  expect(Math.min(...await bodyFills())).toBeGreaterThan(ragged);
  const geometry = await page.evaluate(() => {
    const models = (window as any).__composition.result.paragraphs.flatMap((p: any) => p.lines);
    const rendered = [...document.querySelectorAll('#optimized .composed-line')];
    const column = document.querySelector('#optimized')!.getBoundingClientRect();
    return {
      error: Math.max(...rendered.map((el, i) => Math.abs(el.querySelector('.line-text')!.getBoundingClientRect().width - models[i].width))),
      spill: Math.max(...rendered.map(el => column.left - el.querySelector('.line-text')!.getBoundingClientRect().left)),
      modelled: models.reduce((n: number, l: any) => n + l.kashida, 0),
      rendered: [...document.querySelectorAll('#optimized .kashida')].reduce((n, el) => n + (el.textContent ?? '').length, 0),
    };
  });
  expect(geometry.modelled).toBeGreaterThan(0);
  expect(geometry.rendered).toBe(geometry.modelled);
  expect(geometry.error).toBeLessThan(0.3);
  expect(geometry.spill).toBeLessThan(0.5);
  const expected = await page.locator('#baseline p').allTextContents();
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#optimized')!);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+c');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).not.toContain('ـ');
  expect(copied).toBe(expected.join('\n\n'));
});

test('kashida is disabled without Arabic text', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await expect(page.locator('#kashida')).toBeDisabled();
  await expect(page.locator('#kashida-note')).toContainText('Arabic text only');
});
