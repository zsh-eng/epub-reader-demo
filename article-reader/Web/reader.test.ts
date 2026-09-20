import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const script = readFileSync(resolve(import.meta.dir, '../Resources/reader.js'), 'utf8');

test('extracts metadata, moves the lead image once, and highlights code safely', async () => {
  const page = await browser.newPage();
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/story.html'), 'utf8') }));
  await page.goto('https://fixture.example/story');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.author).toBe('Alex Reader');
  expect(result.description).toContain('On walking slowly');
  expect(result.image).toEndWith('cover.png');
  expect(result.favicon).toEndWith('cover.png');
  expect(result.content).not.toContain('<img');
  expect(result.content).toContain('hljs-keyword');
  expect(result.content).toContain('hljs-string');
  expect(result.content).not.toContain('<script');
  expect(result.authorImage).toBe('');
  await page.close();
});

test('missing author, subtitle, and images remain absent', async () => {
  const page = await browser.newPage();
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/next.html'), 'utf8') }));
  await page.goto('https://fixture.example/next');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.author).toBe('');
  expect(result.description).toBe('');
  expect(result.image).toBe('');
  expect(result.authorImage).toBe('');
  await page.close();
});

test('uses only the declared author image from structured metadata', async () => {
  const page = await browser.newPage();
  const html = readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/story.html'), 'utf8')
    .replace('</head>', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"The quiet art of paying attention","author":{"@type":"Person","name":"Alex Reader","image":{"url":"https://fixture.example/portrait.png"}}}</script></head>');
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://fixture.example/story');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.authorImage).toBe('https://fixture.example/portrait.png');
  await page.close();
});

test('preserves Unicode punctuation and selectable text through extraction', async () => {
  const page = await browser.newPage();
  const sentence = '“Slow down,” she said — café, naïve, 日本語. Keep every character intact.';
  const html = readFileSync(resolve(import.meta.dir, '../Resources/Fixtures/unicode.html'), 'utf8');
  await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://fixture.example/unicode');
  await page.evaluate(script);
  const result = await page.evaluate(() => (globalThis as any).extractArticle());
  expect(result.content).toContain(sentence);
  const css = readFileSync(resolve(import.meta.dir, '../Resources/reader.css'), 'utf8');
  await page.setContent(`<meta charset="utf-8"><style>${css}</style><main><article id="reader-content">${result.content}</article></main>`);
  const selected = await page.evaluate(sentence => {
    const paragraph = [...document.querySelectorAll('p')].find(node => node.textContent === sentence)!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return { text: selection.toString(), selectable: getComputedStyle(paragraph).userSelect };
  }, sentence);
  expect(selected.text).toBe(sentence);
  expect(selected.selectable).not.toBe('none');
  await page.close();
});
