import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const script = readFileSync(new URL('../Resources/reader-position.js', import.meta.url), 'utf8');

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<style>body{margin:0;padding:24px;font:20px/1.6 sans-serif}p{margin:0 0 32px}</style><main>${Array.from({ length: 45 }, (_, index) => `<p>Passage ${index}. A thought worth keeping. Reading gives us space to notice a detail and return to it another day.</p>`).join('')}</main>`);
  await page.evaluate(script);
  await page.evaluate(() => scrollTo(0, 1420));
  return page;
}

test('restores the same paragraph fraction after text reflow', async () => {
  const page = await fixture();
  const saved = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  expect(saved.index).toBeGreaterThan(0);
  await page.evaluate(position => {
    document.body.style.fontSize = '28px';
    scrollTo(0, 0);
    (globalThis as any).arcticPosition.restore(position, 80);
  }, saved);
  const restored = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  expect(restored.anchor).toBe(saved.anchor);
  expect(restored.fraction).toBeCloseTo(saved.fraction, 2);
  await page.close();
});

test('falls back to progress when refreshed text no longer has the saved anchor', async () => {
  const page = await fixture();
  const saved = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  await page.evaluate(position => {
    for (const p of document.querySelectorAll('p')) p.textContent = 'Revised ' + p.textContent;
    scrollTo(0, 0);
    (globalThis as any).arcticPosition.restore(position, 80);
  }, saved);
  const restored = await page.evaluate(() => JSON.parse((globalThis as any).arcticPosition.capture(80)));
  expect(restored.progress).toBeCloseTo(saved.progress, 3);
  await page.close();
});
