import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../Resources/reader.css') + read('../Mac/reader-mac.css');
const selectionScript = read('../Mac/reader-selection.js');

test('desktop text selection stays within the text column while media can be wider', async () => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.setContent(`<style>${css}</style><main><header><h1>A thought worth keeping</h1></header>
    <article id="reader-content"><div><p>One passage with an <em>inline thought</em>.</p><p>A second passage.</p></div>
    <figure class="reader-wide-media"><img width="1200" height="600" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='600'/%3E"></figure></article></main>`);
  const bounds = await page.evaluate(() => {
    const article = document.querySelector('article')!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('article > div')!);
    window.getSelection()!.addRange(range);
    const image = document.querySelector('img')!.getBoundingClientRect();
    return { textWidth: article.width, imageWidth: image.width, imageLeft: image.left,
      selectionFits: [...range.getClientRects()].every(r => r.left >= article.left && r.right <= article.right),
      leading: getComputedStyle(document.querySelector('article')!).lineHeight };
  });
  expect(bounds.textWidth).toBe(640);
  expect(bounds.selectionFits).toBe(true);
  expect(bounds.imageWidth).toBeGreaterThan(bounds.textWidth);
  expect(bounds.imageLeft).toBeGreaterThanOrEqual(0);
  expect(bounds.leading).toBe('28.8px');
  await page.setViewportSize({ width: 500, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(500);
  await page.close();
});

test('native selection controls open after selection and dismiss on scroll or an empty click', async () => {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style><main><article id="reader-content"><p>A quiet thought.</p></article></main>`);
  const messages: unknown[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('receiveSelection', (message: unknown) => messages.push(message));
  await page.evaluate(() => {
    (window as any).webkit = { messageHandlers: { arcticMac: { postMessage: (window as any).receiveSelection } } };
  });
  await page.evaluate(selectionScript);
  await page.locator('p').evaluate(p => {
    const range = document.createRange(); range.selectNodeContents(p);
    window.getSelection()!.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 250, clientY: 80 }));
  });
  await browserExpect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toHaveProperty('selection');
  await browserExpect.poll(() => page.evaluate(() => [...CSS.highlights.get('arctic-selection') ?? []].map(range => range.toString()))).toEqual(['A quiet thought.']);
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await browserExpect.poll(() => messages.length).toBe(2);
  expect(messages[1]).toEqual({ dismissSelection: true });
  await page.mouse.click(20, 20);
  await browserExpect.poll(() => messages.length).toBe(3);
  expect(messages[2]).toEqual({ dismissSelection: true });
  expect(errors).toEqual([]);
  await page.close();
});
