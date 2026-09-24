import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const script = readFileSync(new URL('../Resources/reader-position.js', import.meta.url), 'utf8');

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<style>body{margin:0;padding:24px;font:20px/1.6 sans-serif}p{margin:0 0 32px}</style><main>${Array.from({ length: 12 }, (_, index) => `<p id="passage-${index}">Passage ${index}. A thought worth keeping. Reading gives us space to notice a detail and return to it another day.</p>`).join('')}</main>`);
  await page.evaluate(script);
  await page.evaluate(() => scrollTo(0, 1420));
  return page;
}

// Observe the rendered paragraph and scroll offset independently of capture().
// A capture/restore/capture round trip can pass when both sides share a bug.
async function visibleParagraph(page: import('@playwright/test').Page) {
  return page.locator('p').evaluateAll(paragraphs => {
    const paragraph = paragraphs.find(p => p.getBoundingClientRect().bottom > 80)!;
    const bounds = paragraph.getBoundingClientRect();
    return { id: paragraph.id, fraction: (80 - bounds.top) / bounds.height };
  });
}

test('restores the same visible paragraph after text reflow', async () => {
  const page = await fixture();
  const before = await visibleParagraph(page);
  const saved = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  await page.evaluate(position => {
    document.body.style.fontSize = '28px';
    scrollTo(0, 0);
    (globalThis as any).arcticPosition.restore(position, 80);
  }, saved);
  const after = await visibleParagraph(page);
  expect(after.id).toBe(before.id);
  expect(after.fraction).toBeCloseTo(before.fraction, 2);
  await page.close();
});

test('falls back to scroll progress when refreshed text has no saved anchor', async () => {
  const page = await fixture();
  const before = await page.evaluate(() => scrollY / (document.documentElement.scrollHeight - innerHeight));
  const saved = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  await page.evaluate(position => {
    for (const p of document.querySelectorAll('p')) p.textContent = 'Revised ' + p.textContent;
    scrollTo(0, 0);
    (globalThis as any).arcticPosition.restore(position, 80);
  }, saved);
  const after = await page.evaluate(() => scrollY / (document.documentElement.scrollHeight - innerHeight));
  expect(after).toBeCloseTo(before, 3);
  await page.close();
});
