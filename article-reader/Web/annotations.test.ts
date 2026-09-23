import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const script = readFileSync(resolve(import.meta.dir, '../Resources/annotations.js'), 'utf8');
const fixture = '<article id="reader-content"><p>Before “café” — 日本語 and a <em>quiet thought</em>.</p><p>Another quiet thought stays here.</p></article>';
async function page() {
  const page = await browser.newPage();
  await page.setContent(fixture);
  await page.evaluate(script);
  return page;
}
async function select(page: Page, selector: string) {
  return page.evaluate(selector => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector)!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    return (globalThis as any).arcticAnnotations.selection();
  }, selector);
}
const record = (quote: unknown, id = 'one') => ({ id, quote, isHighlighted: true });

test('captures exact native selection across inline elements without changing document text', async () => {
  const p = await page();
  const quote = await select(p, 'p');
  expect(quote.exact).toBe('Before “café” — 日本語 and a quiet thought.');
  const before = await p.locator('article').innerHTML();
  const missing = await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)]);
  expect(missing).toEqual([]);
  expect(await p.locator('article').innerHTML()).toBe(before);
  expect(await p.evaluate(() => [...CSS.highlights.get('arctic-yellow')!].map(range => range.toString()))).toEqual([quote.exact]);
  await p.close();
});

test('context relocates repeated quotes and leaves ambiguous changed passages unresolved', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  await p.evaluate(() => document.querySelector('article')!.prepend(document.createTextNode('A new preface. ')));
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)])).toEqual([]);
  await p.locator('article').evaluate(node => node.innerHTML = '<p>New quiet thought here.</p><p>New quiet thought there.</p>');
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)])).toEqual(['one']);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('one'))).toBe(false);
  await p.close();
});

test('17.0 fallback merges overlapping marks and removes them without text or markup loss', async () => {
  const p = await page();
  const paragraph = await select(p, 'p');
  const phrase = await select(p, 'em');
  const before = await p.locator('article').innerHTML();
  await p.evaluate(() => { (globalThis as any).Highlight = undefined; });
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(paragraph), record(phrase, 'two')])).toEqual([]);
  expect(await p.locator('mark[data-arctic-highlight]').count()).toBe(3);
  expect(await p.locator('article').textContent()).toBe(paragraph.exact + 'Another quiet thought stays here.');
  await p.evaluate(() => (globalThis as any).arcticAnnotations.render([]));
  expect(await p.locator('article').innerHTML()).toBe(before);
  await p.close();
});

test('non-highlight notes remain revealable, empty and outside selections cannot be saved', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  expect(await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [{ ...record(quote), isHighlighted: false }])).toEqual([]);
  expect(await p.evaluate(() => CSS.highlights.get('arctic-yellow')?.size ?? 0)).toBe(0);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('one'))).toBe(true);
  await p.evaluate(() => window.getSelection()!.removeAllRanges());
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.selection())).toBeNull();
  await p.close();
});


test('recolour updates the painted ranges and tap bridge without changing the article', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  const before = await p.locator('article').innerHTML();
  await p.evaluate(() => {
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
    window.getSelection()!.removeAllRanges();
  });
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'document-one'), [record(quote)]);
  await p.locator('em').click();
  expect(await p.evaluate(() => (globalThis as any).messages)).toEqual([{ id: 'one', token: 'document-one' }]);
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'document-one'), [{ ...record(quote), colour: 'rose' }]);
  expect(await p.evaluate(() => CSS.highlights.get('arctic-yellow')?.size ?? 0)).toBe(0);
  expect(await p.evaluate(() => [...CSS.highlights.get('arctic-rose')!].map(range => range.toString()))).toEqual([quote.exact]);
  expect(await p.locator('article').innerHTML()).toBe(before);
  await p.locator('p').nth(1).click();
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1))).toEqual({ id: '', token: 'document-one' });
  await p.close();
});

test('fallback retains mixed colours, tap ranges and original text across recolours', async () => {
  const p = await page();
  const paragraph = await select(p, 'p');
  const phrase = await select(p, 'em');
  const before = await p.locator('article').innerHTML();
  await p.evaluate(() => { (globalThis as any).Highlight = undefined; window.getSelection()!.removeAllRanges(); });
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(paragraph), { ...record(phrase, 'two'), colour: 'blue' }]);
  expect(await p.locator('em mark[data-arctic-highlight="blue"]').innerText()).toBe(phrase.exact);
  expect(await p.locator('mark mark').count()).toBe(0);
  await p.evaluate(() => (globalThis as any).arcticAnnotations.render([]));
  expect(await p.locator('article').innerHTML()).toBe(before);
  await p.close();
});


test('removal unregisters paint while keeping a note-only passage revealable', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  await p.evaluate(() => window.getSelection()!.removeAllRanges());
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [record(quote)]);
  expect(await p.evaluate(() => CSS.highlights.has('arctic-yellow'))).toBe(true);
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [{ ...record(quote), isHighlighted: false, note: 'Keep this note.' }]);
  expect(await p.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('arctic-')))).toEqual([]);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('one'))).toBe(true);
  expect(await p.locator('mark[data-arctic-highlight]').count()).toBe(0);
  await p.close();
});


test('unanchored article notes never paint or appear as unmatched quotes', async () => {
  const p = await page();
  const missing = await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records), [
    { id: 'standalone', note: 'An article thought.', isHighlighted: false },
    { id: 'null-quote', quote: null, note: 'Another thought.', isHighlighted: false }
  ]);
  expect(missing).toEqual([]);
  expect(await p.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('arctic-')))).toEqual([]);
  expect(await p.evaluate(() => (globalThis as any).arcticAnnotations.reveal('standalone'))).toBe(false);
  await p.close();
});


test('native-created focus dismisses on tap-away and selecting another passage', async () => {
  const p = await page();
  const quote = await select(p, 'em');
  await p.evaluate(() => window.getSelection()!.removeAllRanges());
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'doc'), [record(quote)]);
  await p.evaluate(() => {
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
  });
  // Native creation opens the toolbar and mirrors focus without a DOM tap.
  await p.evaluate(() => (globalThis as any).arcticAnnotations.setFocused('one', 'doc'));
  await p.locator('p').nth(1).click();
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1))).toEqual({ id: '', token: 'doc' });
  await p.locator('em').click();
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1).id)).toBe('one');
  await select(p, 'p:nth-child(2)');
  await p.waitForFunction(() => (globalThis as any).messages.at(-1).id === '');
  // Removing selection after saving must not dismiss the new native focus.
  await p.evaluate(() => { (globalThis as any).messages = []; window.getSelection()!.removeAllRanges(); });
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await p.evaluate(() => (globalThis as any).messages)).toEqual([]);
  expect(await p.evaluate(() => CSS.highlights.get('arctic-yellow')?.size)).toBe(1);
  await p.close();
});

test('highlighted links retain navigation and clear focus', async () => {
  const p = await page();
  await p.locator('em').evaluate(node => { node.innerHTML = '<a href="#next">quiet thought</a>'; });
  const quote = await select(p, 'a');
  await p.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
  });
  await p.evaluate(records => (globalThis as any).arcticAnnotations.render(records, 'doc'), [record(quote)]);
  await p.evaluate(() => (globalThis as any).arcticAnnotations.setFocused('one', 'doc'));
  await p.locator('a').click();
  expect(new URL(p.url()).hash).toBe('#next');
  expect(await p.evaluate(() => (globalThis as any).messages.at(-1))).toEqual({ id: '', token: 'doc' });
  await p.close();
});

test('Show passage retains focus and a subsequent user scroll dismisses it', async () => {
  const p = await page();
  await p.locator('p').first().evaluate(node => (node as HTMLElement).style.height = '1200px');
  const quote = await select(p, 'p:nth-child(2)');
  await p.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    (globalThis as any).messages = [];
    (globalThis as any).webkit = { messageHandlers: { arcticAnnotationTap: {
      postMessage: (message: unknown) => (globalThis as any).messages.push(message)
    } } };
  });
  await p.evaluate(records => {
    (globalThis as any).arcticAnnotations.render(records, 'doc');
    (globalThis as any).arcticAnnotations.reveal('one');
    (globalThis as any).arcticAnnotations.setFocused('one', 'doc');
  }, [record(quote)]);
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await p.evaluate(() => (globalThis as any).messages)).toEqual([]);
  await p.mouse.wheel(0, -100);
  await p.waitForFunction(() => (globalThis as any).messages.at(-1)?.id === '');
  expect(await p.evaluate(() => CSS.highlights.get('arctic-yellow')?.size)).toBe(1);
  await p.close();
});
