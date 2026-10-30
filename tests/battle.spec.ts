/**
 * Browser battle matrix: combined settings in every script, checked against
 * what the reader actually gets. Nothing spills out of the column, Canvas and
 * DOM agree on every line, applied CSS stays inside each control's bounds,
 * tatweels are drawn exactly as modelled, and copying returns the source text.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeParagraphs } from '../bench/corpus';

interface Case {
  name: string;
  language?: 'en' | 'ja' | 'ar';
  typeface?: string;
  direction?: 'ltr' | 'rtl';
  ranges: [string, number][];
  diagnostics?: boolean;
  article?: boolean;
  /** Custom text typed into the editor. */
  text?: string;
  /** Switches to turn on, and selects to set, before the ranges. */
  checks?: string[];
  selects?: [string, string][];
  /** The case must produce hyphenated lines. */
  hyphens?: boolean;
}
const german = 'Die Silbentrennung ist eine alte Kunst der Typografie. Lange Wörter wie Donaudampfschifffahrtsgesellschaft oder Rechtsschutzversicherungsgesellschaften verlangen Aufmerksamkeit, damit der rechte Rand ruhig bleibt.\n\nEin zweiter Absatz zeigt, wie Gemeinschaftsunterkünfte und Verantwortungsbewusstsein in schmalen Spalten getrennt werden.';

const justify: [string, number][] = [['rag', 0], ['firmness', 100], ['word-spacing-min', 25], ['word-spacing-max', 100], ['kashida', 4],
  ['tracking-min', -0.04], ['tracking-max', 0.04], ['sync', 0]];
const cases: Case[] = [
  { name: 'English nearly justified in Georgia', typeface: 'classic', ranges: justify },
  { name: 'English Roboto Flex with every tool', typeface: 'roboto', ranges: [['letter-spacing', 0.03], ['width-flex', 30],
    ['tracking-min', -0.04], ['tracking-max', 0.04], ['rag', 10], ['firmness', 50], ['word-spacing-min', 30], ['word-spacing-max', 400], ['sync', 100]] },
  { name: 'English loose rag, tight letter-spacing, narrow column', ranges: [['letter-spacing', -0.03], ['rag', 18],
    ['measure', 260], ['font-size', 24], ['ending', 55]] },
  { name: 'Arabic kashida, word spacing and width', language: 'ar', ranges: [...justify, ['width-flex', 30]], diagnostics: true },
  { name: 'Arabic forced left-to-right with harmony', language: 'ar', direction: 'ltr', ranges: [['kashida', 2], ['sync', 100], ['rag', 8]] },
  { name: 'Japanese with wide tracking and letter-spacing', language: 'ja', ranges: [['letter-spacing', -0.02],
    ['tracking-min', -0.08], ['tracking-max', 0.08], ['rag', 0], ['firmness', 100]] },
  { name: 'Long article nearly justified (helpers + WebAssembly)', ranges: justify, article: true },
  { name: 'English hyphenation, narrow and frequent', checks: ['hyphenate'], hyphens: true,
    ranges: [['measure', 260], ['hyphen-frequency', 100], ['rag', 0], ['firmness', 100], ['word-spacing-max', 100]] },
  { name: 'German custom text with its hyphenation language', text: german, checks: ['hyphenate'],
    selects: [['hyphen-language', 'de']], hyphens: true, ranges: [['measure', 280], ['hyphen-frequency', 80]] },
];

async function settled(page: Page) {
  await expect(page.locator('#status-message')).toContainText('Composition settled', { timeout: 30000 });
}
async function setRange(page: Page, id: string, value: number) {
  await page.locator(`#${id}`).evaluate((el, n) => {
    (el as HTMLInputElement).value = String(n);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await settled(page);
}

for (const c of cases) {
  test(`battle: ${c.name}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await settled(page);
    if (c.language) { await page.locator('#language').selectOption(c.language); await settled(page); }
    if (c.typeface) { await page.locator('#typeface').selectOption(c.typeface); await settled(page); }
    if (c.direction) { await page.locator('#direction').selectOption(c.direction); await settled(page); }
    if (c.text) {
      await page.locator('#edit-text').click();
      await page.locator('#text-editor').fill(c.text);
      await page.locator('#apply-text').click();
      await settled(page);
    }
    for (const id of c.checks ?? []) { await page.locator(`#${id}`).check({ force: true }); await settled(page); }
    for (const [id, value] of c.selects ?? []) { await page.locator(`#${id}`).selectOption(value); await settled(page); }
    if (c.article) {
      await page.locator('#edit-text').click();
      await page.locator('#text-editor').fill(makeParagraphs(20, 77).join('\n\n'));
      await page.locator('#apply-text').click();
      await settled(page);
    }
    for (const [id, value] of c.ranges) await setRange(page, id, value);
    if (c.diagnostics) { await page.locator('#visualizers').check({ force: true }); await settled(page); }

    const report = await page.evaluate(() => {
      const data = (window as any).__composition;
      const s = data.settings;
      const models = data.result.paragraphs.flatMap((p: any) => p.lines);
      const column = document.querySelector('#optimized')!.getBoundingClientRect();
      const rendered = [...document.querySelectorAll<HTMLElement>('#optimized .composed-line')];
      const problems: string[] = [];
      rendered.forEach((el, i) => {
        const model = models[i];
        const text = el.querySelector<HTMLElement>('.line-text')!;
        const box = text.getBoundingClientRect();
        const arabic = /[؀-ۿ]/u.test(model.text);
        if (Math.abs(box.width - model.width) > (/[぀-ヿ一-鿿]/u.test(model.text) ? 0.5 : 0.3)) problems.push(`line ${i}: DOM ${box.width.toFixed(2)} vs model ${model.width.toFixed(2)}`);
        if (box.right > column.right + 0.5 || box.left < column.left - 0.5) problems.push(`line ${i}: spills (${box.left.toFixed(1)}–${box.right.toFixed(1)} in ${column.left.toFixed(1)}–${column.right.toFixed(1)})`);
        const fontSize = parseFloat(getComputedStyle(el).fontSize);
        const letter = parseFloat(getComputedStyle(el).letterSpacing) / fontSize || 0;
        const baseSpacing = arabic ? 0 : s.letterSpacing ?? 0;
        const [min, max] = arabic ? [0, 0] : [s.trackingMin, s.trackingMax];
        if (letter < baseSpacing + min - 1e-3 || letter > baseSpacing + max + 1e-3) problems.push(`line ${i}: letter-spacing ${letter.toFixed(4)}em outside ${baseSpacing + min}…${baseSpacing + max}`);
        const stretch = parseFloat(getComputedStyle(el).fontStretch) || 100;
        if (stretch < 100 - Math.round((s.widthFlex ?? 0) * 100) - 1e-6 || stretch > 100) problems.push(`line ${i}: font-stretch ${stretch}%`);
        const tatweels = [...el.querySelectorAll('.kashida')].reduce((n, k) => n + (k.textContent ?? '').length, 0);
        if (tatweels !== model.kashida) problems.push(`line ${i}: ${tatweels} tatweels drawn, ${model.kashida} modelled`);
        if (Boolean(el.querySelector('.hyphen')) !== model.hyphen) problems.push(`line ${i}: hyphen drawn ${!model.hyphen}, modelled ${model.hyphen}`);
      });
      return {
        problems, lines: rendered.length, models: models.length, hyphens: models.filter((l: any) => l.hyphen).length,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(report.lines).toBe(report.models);
    expect(report.pageOverflow).toBe(false);
    expect(report.problems).toEqual([]);
    if (c.hyphens) expect(report.hyphens).toBeGreaterThan(0);

    // Copy the whole composed column through the real clipboard.
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
}

// ---------------------------------------------------------------------------
// Effects with real fonts: each control must improve what it claims to, as
// measured on the actual composition (not only stay within its bounds).

async function bodyFills(page: Page) {
  return page.evaluate(() => (window as any).__composition.result.paragraphs
    .map((p: any) => p.lines.slice(0, -1).map((l: any) => l.fill)) as number[][]);
}
const shortest = (fills: number[][]) => Math.min(...fills.flat());

test('effect: harmony never shortens a paragraph’s lines (the Georgia case)', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1100 });
  await page.goto('/');
  await settled(page);
  await page.locator('#typeface').selectOption('classic');
  await settled(page);
  for (const [id, v] of [['measure', 401], ['letter-spacing', -0.01], ['tracking-min', -0.008], ['tracking-max', 0.008],
    ['rag', 0], ['firmness', 80], ['word-spacing-min', 50], ['word-spacing-max', 50]] as [string, number][]) await setRange(page, id, v);
  await setRange(page, 'sync', 0);
  const independent = await bodyFills(page);
  await setRange(page, 'sync', 100);
  const concert = await bodyFills(page);
  independent.forEach((fills, i) => {
    if (!fills.length) return;
    expect(Math.min(...concert[i]), `¶${i + 1}`).toBeGreaterThanOrEqual(Math.min(...fills) - 0.011);
  });
});

for (const [name, setup, before, after] of [
  ['space stretch lengthens the shortest line (Georgia)', { typeface: 'classic' }, [['word-spacing-max', 0]], [['word-spacing-max', 300]]],
  ['kashida lengthens the shortest Arabic line', { language: 'ar' }, [['kashida', 0]], [['kashida', 4]]],
] as [string, { typeface?: string; language?: string; hyphenate?: boolean; measure?: number }, [string, number][], [string, number][]][]) {
  test(`effect: ${name}`, async ({ page }) => {
    await page.goto('/');
    await settled(page);
    if (setup.language) { await page.locator('#language').selectOption(setup.language); await settled(page); }
    if (setup.typeface) { await page.locator('#typeface').selectOption(setup.typeface); await settled(page); }
    if (setup.hyphenate) { await page.locator('#hyphenate').check({ force: true }); await settled(page); }
    if (setup.measure) await setRange(page, 'measure', setup.measure);
    await setRange(page, 'rag', 0);
    await setRange(page, 'firmness', 100);
    for (const [id, v] of before) await setRange(page, id, v);
    const without = shortest(await bodyFills(page));
    for (const [id, v] of after) await setRange(page, id, v);
    const with_ = shortest(await bodyFills(page));
    expect(with_, `shortest body line ${with_} vs ${without}`).toBeGreaterThan(without);
  });
}

test('effect: rare hyphens are rarer, and frequent ones even the edge (Georgia, 260 px)', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await page.locator('#typeface').selectOption('classic');
  await settled(page);
  await page.locator('#hyphenate').check({ force: true });
  await settled(page);
  for (const [id, v] of [['measure', 260], ['rag', 0], ['firmness', 60]] as [string, number][]) await setRange(page, id, v);
  const read = () => page.evaluate(() => {
    const lines = (window as any).__composition.result.paragraphs.flatMap((p: any) => p.lines.slice(0, -1));
    return { hyphens: lines.filter((l: any) => l.hyphen).length, shortfall: lines.reduce((n: number, l: any) => n + 1 - l.fill, 0) };
  });
  await setRange(page, 'hyphen-frequency', 0);
  const rare = await read();
  await setRange(page, 'hyphen-frequency', 100);
  const frequent = await read();
  expect(rare.hyphens, `rare ${rare.hyphens} vs frequent ${frequent.hyphens}`).toBeLessThan(frequent.hyphens);
  expect(frequent.shortfall).toBeLessThanOrEqual(rare.shortfall + 1e-9);
});
