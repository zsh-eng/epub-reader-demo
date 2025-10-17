# Highlight System Specification

## Overview

This document specifies how text highlighting works in the EPUB reader, including what data we store, how we calculate positions, and how we handle edge cases with fallback mechanisms.

## Core Concept: Text-Only Offsets

### What is an "Offset"?

An **offset** is a character position within the **text-only content** of an EPUB chapter (spine item), with all HTML tags stripped out.

#### Example:

Given this HTML:
```html
<div>
  <p>Hello, <strong>world</strong>!</p>
  <p>This is a test.</p>
</div>
```

The **text-only content** is:
```
Hello, world!This is a test.
```

Note: Whitespace between block elements is collapsed (like in browser rendering).

If we highlight the word "world", the offsets would be:
- `startOffset`: 7 (position of 'w')
- `endOffset`: 12 (position after '!')
- `selectedText`: "world"

### Why Text-Only Offsets?

1. **EPUB content is static** - The HTML files never change once the EPUB is created
2. **HTML-aware offsets are brittle** - Whitespace, formatting changes break them
3. **Text offsets are intuitive** - They represent what the user actually sees
4. **Cross-platform compatible** - Different parsers produce the same text content

## Data Schema

### Highlight Interface

```typescript
interface Highlight {
  // Identity
  id: string;                    // UUID
  bookId: string;                // Foreign key to Book
  spineItemId: string;           // The spine item's idref (identifies the chapter)

  // Position (Primary method)
  startOffset: number;           // Character offset in text-only content
  endOffset: number;             // Character offset in text-only content

  // Content (For fallback matching)
  selectedText: string;          // The actual highlighted text (max ~500 chars)
  textBefore: string;            // ~50 chars before highlight (for context)
  textAfter: string;             // ~50 chars after highlight (for context)

  // Styling
  color: 'yellow' | 'green' | 'blue' | 'pink';  // Predefined color names

  // Optional annotation
  note?: string;                 // User's notes on this highlight

  // Metadata
  createdAt: Date;
  updatedAt?: Date;
}
```

### Database Schema Addition

```typescript
// In db.ts
highlights!: Table<Highlight, string>;

// Indexes for efficient querying
this.version(2).stores({
  // ... existing stores ...
  highlights: "id, bookId, [bookId+spineItemId], createdAt"
});
```

The compound index `[bookId+spineItemId]` allows efficient queries like:
```typescript
db.highlights.where(['bookId', 'spineItemId']).equals([bookId, 'chapter01']).toArray()
```

## Calculating Offsets

### Algorithm: HTML to Text-Only Content

```typescript
function extractTextContent(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Use browser's built-in text extraction
  // This handles whitespace correctly (block vs inline elements)
  return doc.body.textContent || '';
}
```

Browser's `textContent` automatically:
- Strips all HTML tags
- Collapses whitespace appropriately
- Handles block-level vs inline elements correctly

### Creating a Highlight from User Selection

```typescript
function createHighlightFromSelection(
  selection: Selection,
  containerElement: HTMLElement,
  bookId: string,
  spineItemId: string
): Highlight {
  // 1. Get the selected text
  const selectedText = selection.toString().trim();

  // 2. Get the full text content of the chapter
  const fullText = containerElement.textContent || '';

  // 3. Calculate offsets using Range API
  const range = selection.getRangeAt(0);
  const startOffset = getTextOffset(containerElement, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(containerElement, range.endContainer, range.endOffset);

  // 4. Extract context (50 chars before and after)
  const textBefore = fullText.substring(Math.max(0, startOffset - 50), startOffset);
  const textAfter = fullText.substring(endOffset, Math.min(fullText.length, endOffset + 50));

  // 5. Create highlight object
  return {
    id: crypto.randomUUID(),
    bookId,
    spineItemId,
    startOffset,
    endOffset,
    selectedText,
    textBefore,
    textAfter,
    color: 'yellow', // Default yellow
    createdAt: new Date()
  };
}

function getTextOffset(
  container: Node,
  targetNode: Node,
  targetOffset: number
): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(targetNode, targetOffset);
  return range.toString().length;
}
```

## Applying Highlights to HTML

### Primary Method: Direct Offset Matching

```typescript
function applyHighlightsToHTML(
  html: string,
  highlights: Highlight[]
): string {
  if (highlights.length === 0) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  // Sort highlights by position to handle them in order
  const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);

  for (const highlight of sorted) {
    try {
      // Try primary method: direct offset
      const range = findRangeByTextOffset(body, highlight.startOffset, highlight.endOffset);

      if (range && verifyRangeText(range, highlight.selectedText)) {
        wrapRangeWithHighlight(range, highlight, doc);
      } else {
        // Fallback to context-based matching
        const fallbackRange = findRangeByContext(body, highlight);
        if (fallbackRange) {
          wrapRangeWithHighlight(fallbackRange, highlight, doc);
        } else {
          console.warn('Failed to apply highlight:', highlight.id);
        }
      }
    } catch (error) {
      console.error('Error applying highlight:', highlight.id, error);
    }
  }

  return body.innerHTML;
}
```

### Fallback Method: Context-Based Matching

When direct offsets fail (shouldn't happen with static EPUB content, but we handle it anyway):

```typescript
function findRangeByContext(
  container: Node,
  highlight: Highlight
): Range | null {
  const fullText = container.textContent || '';

  // Strategy 1: Match with full context
  const searchPattern = highlight.textBefore + highlight.selectedText + highlight.textAfter;
  let position = fullText.indexOf(searchPattern);

  if (position !== -1) {
    const start = position + highlight.textBefore.length;
    const end = start + highlight.selectedText.length;
    return findRangeByTextOffset(container, start, end);
  }

  // Strategy 2: Match with partial context (before + text)
  const partialPattern = highlight.textBefore + highlight.selectedText;
  position = fullText.indexOf(partialPattern);

  if (position !== -1) {
    const start = position + highlight.textBefore.length;
    const end = start + highlight.selectedText.length;
    return findRangeByTextOffset(container, start, end);
  }

  // Strategy 3: Match just the selected text
  // Only use if text is unique enough (>20 chars) to avoid false matches
  if (highlight.selectedText.length > 20) {
    position = fullText.indexOf(highlight.selectedText);
    if (position !== -1) {
      const end = position + highlight.selectedText.length;
      return findRangeByTextOffset(container, position, end);
    }
  }

  return null;
}
```

### Helper: Find Range by Text Offset

```typescript
function findRangeByTextOffset(
  container: Node,
  startOffset: number,
  endOffset: number
): Range | null {
  const range = document.createRange();
  let currentOffset = 0;

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  let startNode: Node | null = null;
  let startNodeOffset = 0;
  let endNode: Node | null = null;
  let endNodeOffset = 0;
  let foundStart = false;

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.textContent || '';
    const length = text.length;

    // Find start position
    if (!foundStart && currentOffset + length > startOffset) {
      startNode = textNode;
      startNodeOffset = startOffset - currentOffset;
      foundStart = true;
    }

    // Find end position
    if (foundStart && currentOffset + length >= endOffset) {
      endNode = textNode;
      endNodeOffset = endOffset - currentOffset;
      break;
    }

    currentOffset += length;
  }

  if (startNode && endNode) {
    try {
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      return range;
    } catch (error) {
      console.error('Invalid range:', error);
      return null;
    }
  }

  return null;
}
```

### Helper: Wrap Range with Highlight

```typescript
function wrapRangeWithHighlight(
  range: Range,
  highlight: Highlight,
  doc: Document
): void {
  const mark = doc.createElement('mark');
  mark.className = 'epub-highlight';
  mark.dataset.highlightId = highlight.id;
  mark.dataset.color = highlight.color;
  mark.style.cursor = 'pointer';

  try {
    range.surroundContents(mark);
  } catch (error) {
    // surroundContents fails if range crosses element boundaries
    // Use extractContents + appendChild instead
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }
}
```

### Helper: Verify Range Text

```typescript
function verifyRangeText(range: Range, expectedText: string): boolean {
  const rangeText = range.toString().trim();
  const expected = expectedText.trim();

  // Allow minor whitespace differences
  return rangeText === expected ||
         rangeText.replace(/\s+/g, ' ') === expected.replace(/\s+/g, ' ');
}
```

## Edge Cases & Considerations

### 1. Overlapping Highlights

**Problem**: User highlights text that overlaps with existing highlight.

**Solution**: For MVP, disallow overlapping highlights. Show error message. Future: Support nested/adjacent highlights with more complex DOM manipulation.

### 2. Highlights Across Elements

**Problem**: User selects text that spans multiple HTML elements (e.g., crosses paragraph boundary).

**Solution**: The `Range.surroundContents()` will fail. Use `extractContents()` + `insertNode()` instead (shown in code above).

### 3. Very Long Highlights

**Problem**: User highlights entire chapter (thousands of characters).

**Solution**: Set reasonable limits:
- Max 500 characters for `selectedText` in database
- Store full text in a separate field if needed
- UI warning for highlights >1000 chars

### 4. Whitespace Handling

**Problem**: Selection includes extra whitespace, or HTML whitespace is collapsed differently.

**Solution**:
- Always `.trim()` selected text
- Use normalized whitespace comparison in `verifyRangeText()`

### 5. Special Characters

**Problem**: HTML entities (`&nbsp;`, `&mdash;`, etc.) vs actual characters.

**Solution**: Browser's DOMParser handles this automatically. `textContent` returns actual characters, not entities.

## User Interaction Flow

### Creating a Highlight

```
1. User selects text in reader
   ↓
2. Show highlight button/menu (tooltip near selection)
   ↓
3. User clicks "Highlight" button
   ↓
4. Calculate offsets from selection
   ↓
5. Save to database
   ↓
6. Re-render chapter with highlight applied
```

### Viewing Highlights

```
1. Load chapter content
   ↓
2. Query highlights for current bookId + spineItemId
   ↓
3. Apply highlights to HTML (preprocessing)
   ↓
4. Render with dangerouslySetInnerHTML
```

### Deleting a Highlight

```
1. User clicks on highlighted text
   ↓
2. Show context menu with "Delete Highlight" option
   ↓
3. Delete from database
   ↓
4. Re-render chapter without that highlight
```

## CSS Styling

```css
.epub-highlight {
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.epub-highlight:hover {
  opacity: 0.8;
  outline: 1px solid rgba(0, 0, 0, 0.1);
}

/* Predefined colors */
.epub-highlight[data-color="yellow"] {
  background-color: rgba(255, 235, 59, 0.35);
}

.epub-highlight[data-color="green"] {
  background-color: rgba(76, 175, 80, 0.35);
}

.epub-highlight[data-color="blue"] {
  background-color: rgba(33, 150, 243, 0.35);
}

.epub-highlight[data-color="pink"] {
  background-color: rgba(233, 30, 99, 0.35);
}
```

## Performance Considerations

### Database Queries

- Index on `[bookId+spineItemId]` for fast chapter-specific queries
- Typical chapter: 5-20 highlights
- Query time: <1ms

### HTML Processing

- Parsing HTML: ~5-10ms per chapter
- Walking text nodes: ~1-5ms per chapter
- Applying 10 highlights: ~5-10ms total
- **Total overhead: ~20-30ms per chapter load** (acceptable)

### Memory

- Average highlight: ~200 bytes
- 1000 highlights: ~200KB
- Negligible compared to EPUB content itself

## Future Enhancements

### Phase 2: Advanced Features

1. **Multiple highlight colors** - Allow user to choose color when highlighting
2. **Notes on highlights** - Add text notes/annotations
3. **Highlight list view** - Show all highlights for a book in a panel
4. **Export highlights** - Export to Markdown, text, or JSON
5. **Search highlights** - Full-text search across all highlights
6. **Share highlights** - Generate shareable links/text

### Phase 3: EPUB CFI Support

Consider implementing EPUB CFI (Canonical Fragment Identifier) for maximum compatibility:
- More robust than offsets
- Industry standard (used by Readium, Kobo, etc.)
- Requires library: `epub-cfi-resolver`

Example CFI: `epubcfi(/6/4[chap01ref]!/4/2/1:3[iss,0])`

## Testing Strategy

### Unit Tests

1. **Offset calculation**: Verify `getTextOffset()` with various HTML structures
2. **Range finding**: Test `findRangeByTextOffset()` with edge cases
3. **Fallback matching**: Test context-based matching with partial matches

### Integration Tests

1. **End-to-end highlight creation**: Select text → save → reload → verify rendering
2. **Multiple highlights**: Apply 10+ highlights to same chapter
3. **Cross-element highlights**: Select across paragraphs, bold text, etc.

### Edge Case Tests

1. Empty selections
2. Very long selections (>1000 chars)
3. Selections at start/end of chapter
4. Special characters (em dash, quotes, etc.)
5. Highlights in nested HTML (lists, tables)

## References

- [DOM Range API](https://developer.mozilla.org/en-US/docs/Web/API/Range)
- [Selection API](https://developer.mozilla.org/en-US/docs/Web/API/Selection)
- [EPUB CFI Spec](http://www.idpf.org/epub/linking/cfi/epub-cfi.html)
- [TreeWalker API](https://developer.mozilla.org/en-US/docs/Web/API/TreeWalker)
