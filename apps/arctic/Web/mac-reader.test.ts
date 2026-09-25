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


test('desktop headlines keep their type size when sidebars change the viewport', async () => {
  const page = await browser.newPage({ viewport: { width: 1250, height: 900 } });
  await page.setContent(`<style>${css}</style><main><header><h1>A long title that should wrap without shrinking</h1></header><article id="reader-content"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='300'/%3E"></article></main>`);
  const heading = page.locator('h1');
  const originalSize = await heading.evaluate(el => getComputedStyle(el).fontSize);
  for (const width of [1033, 733, 1250]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await heading.evaluate(el => getComputedStyle(el).fontSize)).toBe(originalSize);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  expect(await page.locator('img').evaluate(el => getComputedStyle(el).borderRadius)).toBe('12px');
  await page.close();
});


test('frame diagnostics stay opt-in, publish timing, and stop cleanly', async () => {
  const page = await browser.newPage();
  await page.clock.install();
  await page.setContent('<p>A local frame timing replay.</p>');
  await page.evaluate(() => {
    (window as any).samples = [];
    (window as any).webkit = { messageHandlers: { arcticMac: { postMessage: (v: unknown) => (window as any).samples.push(v) } } };
  });
  await page.evaluate(read('../Web/reader-diagnostics.js'));
  await page.clock.runFor(1200);
  expect(await page.evaluate(() => (window as any).samples.length)).toBe(0);
  await page.evaluate(() => (window as any).arcticDiagnostics.start(120));
  await page.clock.runFor(1200);
  const first = await page.evaluate(() => (window as any).samples.at(-1).diagnostics);
  expect(first.fps).toBeGreaterThan(0);
  expect(first.frames).toEqual([]);
  await page.evaluate(() => (window as any).arcticDiagnostics.record(true));
  await page.clock.runFor(1200);
  expect(await page.evaluate(() => (window as any).samples.at(-1).diagnostics.frames.length)).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).arcticDiagnostics.stop());
  const stopped = await page.evaluate(() => (window as any).samples.length);
  await page.clock.runFor(1500);
  expect(await page.evaluate(() => (window as any).samples.length)).toBe(stopped);
  await page.close();
});
