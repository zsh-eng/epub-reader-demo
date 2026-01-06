/**
 * E2E Test Fixtures
 *
 * Provides utilities for setting up and cleaning up test state.
 * Uses Playwright's built-in test fixtures for configuration.
 */

import { test as base, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the sample EPUB fixture
export const SAMPLE_EPUB_PATH = path.join(__dirname, '../../fixtures/sample.epub');

/**
 * Extended test fixture with commonly used helpers
 */
export const test = base.extend<{
    /**
     * Add a book to the library by uploading via the file picker
     * Returns the page for chaining
     */
    addSampleBook: () => Promise<void>;
}>({
    addSampleBook: async ({ page }, use) => {
        const addBook = async () => {
            // Create a file input promise before clicking to avoid race conditions
            const fileChooserPromise = page.waitForEvent('filechooser');

            // Click the add book button - in empty state it's "Import EPUB", otherwise it's the Plus icon
            const importButton = page.getByRole('button', { name: 'Import EPUB' });
            if (await importButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await importButton.click();
            } else {
                // Click the plus button in the header
                await page.locator('button').filter({ has: page.locator('svg.lucide-plus') }).click();
            }

            // Wait for and handle the file chooser
            const fileChooser = await fileChooserPromise;
            await fileChooser.setFiles(SAMPLE_EPUB_PATH);

            // Wait for book processing - look for toast
            await page.waitForSelector('text="Import complete"', { timeout: 30000 });

            // Wait for toast to disappear before returning
            await page.waitForTimeout(2000);
        };

        await use(addBook);
    },
});

export { expect } from '@playwright/test';

/**
 * Wait for the library page to be fully loaded
 */
export async function waitForLibraryLoaded(page: Page): Promise<void> {
    // Wait for the loading spinner to disappear
    await page.waitForFunction(() => {
        return !document.body.textContent?.includes('Loading library...');
    });
}

/**
 * Clear all IndexedDB databases
 * Useful for ensuring clean state between tests
 */
export async function clearIndexedDB(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const databases = await indexedDB.databases();
        for (const db of databases) {
            if (db.name) {
                indexedDB.deleteDatabase(db.name);
            }
        }
    });
}

/**
 * Helper to navigate to the reader for the first book in the library
 */
export async function openFirstBook(page: Page): Promise<void> {
    // Click on the first book title/cover
    const bookCard = page.locator('.group.relative').first();
    await bookCard.click();

    // Wait for reader URL
    await page.waitForURL(/\/reader\/.+/);
}
