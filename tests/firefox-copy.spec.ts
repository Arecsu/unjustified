/**
 * Firefox builds clipboard text with its own serializer, which can insert line
 * breaks that `selection.toString()` does not show. These tests read the real
 * clipboard after a mouse-drag selection.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function settled(page: Page) {
  await expect(page.locator('#status-message')).toContainText('Composition settled', { timeout: 20000 });
}
async function setRange(page: Page, id: string, value: number) {
  await page.locator(`#${id}`).evaluate((el, n) => {
    (el as HTMLInputElement).value = String(n);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await settled(page);
}
/** Drag from the first composed line to the end of the last, then copy. */
async function dragCopy(page: Page) {
  // The whole column must be on screen: a drag past the viewport selects the page.
  await page.setViewportSize({ width: 1440, height: 2000 });
  const lines = page.locator('#optimized .composed-line');
  await lines.first().scrollIntoViewIfNeeded();
  const first = (await lines.first().boundingBox())!, last = (await lines.last().boundingBox())!;
  const rtl = await page.locator('#optimized p').first().evaluate(p => p.getAttribute('dir') === 'rtl');
  await page.mouse.move(rtl ? first.x + first.width - 1 : first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(rtl ? last.x + 1 : last.x + last.width - 1, last.y + last.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.keyboard.press('Meta+c');
  return page.evaluate(() => navigator.clipboard.readText());
}
const paragraphs = (page: Page) => page.locator('#baseline p').allTextContents();

test('Firefox copies composed English as whole paragraphs', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await page.locator('#guides').check({ force: true });
  const copied = await dragCopy(page);
  expect(copied.trim()).toBe((await paragraphs(page)).join('\n\n').trim());
});

test('Firefox copies Arabic with kashida and diagnostics as the original text', async ({ page }) => {
  await page.goto('/');
  await page.locator('#language').selectOption('ar');
  await settled(page);
  await setRange(page, 'rag', 0);
  await setRange(page, 'firmness', 100);
  await setRange(page, 'kashida', 4);
  await page.locator('#visualizers').check({ force: true });
  const copied = await dragCopy(page);
  expect(copied).not.toContain('ـ');
  expect(copied.trim()).toBe((await paragraphs(page)).join('\n\n').trim());
});
