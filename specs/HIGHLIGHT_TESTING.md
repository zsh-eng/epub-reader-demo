# Highlight Feature Testing Guide

## What We've Built

We've implemented the basic highlight functionality for the EPUB reader. Here's what's included:

### Components Created

1. **`src/lib/highlight-constants.ts`**
   - Defines the 4 highlight colors: yellow, green, blue, and magenta
   - Exports color definitions with both rgba and hex values

2. **`src/lib/highlight-utils.ts`**
   - `extractTextContent()` - Extracts text-only content from HTML
   - `getTextOffset()` - Calculates character offset within text
   - `createHighlightFromSelection()` - Creates highlight data from user selection
   - `getSelectionPosition()` - Gets position for toolbar placement

3. **`src/components/HighlightToolbar.tsx`**
   - Floating toolbar that appears on text selection
   - Shows 4 color circles for highlight selection
   - Auto-positions above selection (or below if no space)
   - Closes when clicking outside

4. **Updated `src/components/Reader.tsx`**
   - Integrated text selection handling
   - Shows highlight toolbar on text selection
   - Logs offset data to console when color is selected
   - Does NOT save to database yet (as requested)

## How to Test

1. **Start the Development Server**
   ```bash
   npm run dev
   # or
   bun run dev
   ```

2. **Open the Reader**
   - Navigate to your library
   - Open any EPUB book
   - Go to any chapter with text content

3. **Select Text**
   - Click and drag to select any text in the chapter
   - A floating toolbar should appear above your selection
   - The toolbar contains 4 colored circles (yellow, green, blue, magenta)

4. **Create a Highlight**
   - Click on any color circle
   - Check the browser console (F12 → Console)
   - You should see output like:
     ```
     === Highlight Created ===
     Color: yellow
     Start Offset: 245
     End Offset: 267
     Selected Text: this is the highlighted text
     Text Before: ...preceding context...
     Text After: ...following context...
     ========================
     ```

5. **Test Different Scenarios**
   - Short selections (a few words)
   - Long selections (multiple sentences)
   - Selections across paragraphs
   - Selections with special characters
   - Selections at the start/end of chapter

## Expected Behavior

### ✅ What Should Work

- Toolbar appears on text selection
- Toolbar is positioned above the selection (centered)
- Toolbar stays within viewport boundaries
- Clicking a color logs complete offset data to console
- Selection is cleared after clicking a color
- Toolbar closes when clicking outside
- Toolbar closes after color selection

### ⚠️ What's NOT Implemented Yet

- Saving highlights to database
- Displaying saved highlights on chapter load
- Editing/deleting existing highlights
- Adding notes to highlights
- Highlight list view
- Export functionality

## Console Output Explanation

When you click a highlight color, the console shows:

- **Color**: The selected highlight color name
- **Start Offset**: Character position where highlight starts (in text-only content)
- **End Offset**: Character position where highlight ends
- **Selected Text**: The actual text that was highlighted
- **Text Before**: 50 characters before the highlight (for context matching)
- **Text After**: 50 characters after the highlight (for context matching)

These offsets are calculated based on the text-only content of the chapter with all HTML tags stripped out, as specified in the HIGHLIGHT.md spec.

## Known Limitations

1. **No Persistence**: Highlights are not saved, so they disappear on chapter change or page reload
2. **No Visual Feedback**: Selected text is not visually highlighted after clicking a color
3. **No Overlap Detection**: You can "create" overlapping highlights (though they're only logged)

## Next Steps

The foundation is now ready for:
1. Adding database schema for highlights
2. Saving highlight data to IndexedDB
3. Retrieving and applying highlights on chapter load
4. Adding visual rendering of highlights with `<mark>` tags

## Troubleshooting

### Toolbar Doesn't Appear
- Make sure you're selecting text within the chapter content area
- Check that you're dragging to select (not just clicking)
- Verify the selection contains actual text (not just whitespace)

### Console Shows No Output
- Open browser DevTools (F12)
- Go to the Console tab
- Try selecting text and clicking a color again
- Check for any JavaScript errors

### Toolbar Position is Wrong
- This can happen with certain zoom levels or viewport sizes
- The toolbar should auto-adjust to stay within viewport
- Try refreshing the page if positioning seems off
