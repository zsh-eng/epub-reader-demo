/**
 * Library E2E Tests
 *
 * Tests for the main library page functionality:
 * - Empty state display
 * - Adding books via file picker
 * - Book display and search
 */

import { test, expect, waitForLibraryLoaded, clearIndexedDB, SAMPLE_EPUB_PATH } from './helpers/fixtures';

test.describe('Library', () => {
    test.beforeEach(async ({ page }) => {
        // Clear IndexedDB to ensure clean state
        await page.goto('/');
        await clearIndexedDB(page);
        // Reload after clearing to get fresh state
        await page.reload();
        await waitForLibraryLoaded(page);
    });

    test('should display empty library initially', async ({ page }) => {
        await expect(page.getByText('Your library is empty')).toBeVisible();
        await expect(page.getByText('Drag and drop an EPUB file here')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Import EPUB' })).toBeVisible();
    });

    test('should add a book via file picker', async ({ page }) => {
        // Trigger file picker by clicking the Import EPUB button
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import EPUB' }).click();

        // Upload the sample EPUB
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(SAMPLE_EPUB_PATH);

        // Wait for success toast
        await expect(page.getByText('has been added to your library')).toBeVisible({ timeout: 30000 });

        // Wait for toast to disappear, then check the library
        await page.waitForTimeout(2000);

        // Library should no longer show empty state
        await expect(page.getByText('Your library is empty')).not.toBeVisible();

        // Book card should be visible - use the heading role which is more specific
        await expect(page.getByRole('heading', { name: /Alice.*Adventures.*Wonderland/i })).toBeVisible();
    });

    test('should search books by title', async ({ page }) => {
        // Add a book first (inline, not using fixture)
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import EPUB' }).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(SAMPLE_EPUB_PATH);
        await expect(page.getByText('has been added to your library')).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(2000);

        // Verify book heading is visible
        const bookHeading = page.getByRole('heading', { name: /Alice.*Adventures.*Wonderland/i });
        await expect(bookHeading).toBeVisible();

        // Search for the book
        const searchInput = page.getByPlaceholder('Search books...');
        await searchInput.fill('Alice');

        // Book should still be visible
        await expect(bookHeading).toBeVisible();

        // Search for something that doesn't exist
        await searchInput.fill('Nonexistent Book');

        // Should show "No books found"
        await expect(page.getByText('No books found')).toBeVisible();
        await expect(bookHeading).not.toBeVisible();

        // Clear search
        await searchInput.fill('');

        // Book should be visible again
        await expect(bookHeading).toBeVisible();
    });

    test('should open a book from library', async ({ page }) => {
        // Add a book first (inline, not using fixture)
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import EPUB' }).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(SAMPLE_EPUB_PATH);
        await expect(page.getByText('has been added to your library')).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(2000);

        // Click on the book heading (more specific than getByText)
        await page.getByRole('heading', { name: /Alice.*Adventures.*Wonderland/i }).click();

        // Should navigate to reader page
        await expect(page).toHaveURL(/\/reader\/.+/);
    });
});
