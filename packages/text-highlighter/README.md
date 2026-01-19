# @zsh-eng/text-highlighter

A lightweight, zero-dependency library for creating and restoring text highlights in the DOM using text offsets.

## Features

- **Portable highlights** - Uses text offsets instead of XPath/DOM references, making highlights resilient to DOM changes
- **Block-aware wrapping** - Correctly handles selections spanning multiple block elements
- **Context-based fallback** - Stores surrounding text for fallback matching when content drifts
- **Zero dependencies** - Works in any browser environment

## Installation

```bash
npm install @zsh-eng/text-highlighter
# or
bun add @zsh-eng/text-highlighter
# or
pnpm add @zsh-eng/text-highlighter
```

## Quick Start

### Creating a highlight from user selection

```ts
import {
  createHighlightFromSelection,
  applyHighlight,
} from "@zsh-eng/text-highlighter";

// When user selects text
document.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const container = document.getElementById("content")!;

  // Create highlight data (portable, can be stored in database)
  const highlightData = createHighlightFromSelection(selection, container);

  if (highlightData) {
    // Apply it to the DOM
    applyHighlight(container, highlightData, {
      className: "highlight",
      attributes: { "data-highlight-id": crypto.randomUUID() },
    });

    // Clear the selection
    selection.removeAllRanges();
  }
});
```

### Restoring highlights from saved data

```ts
import { applyHighlights } from "@zsh-eng/text-highlighter";

// Highlights retrieved from database/storage
const savedHighlights = [
  {
    id: "highlight-1",
    startOffset: 0,
    endOffset: 12,
    selectedText: "Hello world!",
  },
  {
    id: "highlight-2",
    startOffset: 50,
    endOffset: 75,
    selectedText: "important paragraph here",
  },
];

const container = document.getElementById("content")!;

// Apply all highlights - returns array of successfully applied IDs
const appliedIds = applyHighlights(container, savedHighlights, {
  className: "highlight",
  tagName: "mark",
});

console.log(`Applied ${appliedIds.length} highlights`);
```

### Removing highlights

```ts
import { removeHighlightById } from "@zsh-eng/text-highlighter";

const container = document.getElementById("content")!;

// Remove by ID
removeHighlightById(container, "highlight-1");
```

### Positioning a toolbar near the selection

```ts
import {
  getSelectionPosition,
  createHighlightFromSelection,
} from "@zsh-eng/text-highlighter";

document.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const position = getSelectionPosition(selection);
  if (position) {
    // Position your toolbar at the center-top of the selection
    toolbar.style.left = `${position.x}px`;
    toolbar.style.top = `${position.y - toolbarHeight}px`;
  }
});
```

### Managing highlight interactions (vanilla JS)

Handle hover, click, and active states with a single manager:

```ts
import { createHighlightInteractionManager } from "@zsh-eng/text-highlighter";

const container = document.getElementById("content")!;

const manager = createHighlightInteractionManager(container, {
  highlightClass: "highlight",
  idAttribute: "data-highlight-id",
  hoverClass: "highlight-hover",
  activeClass: "highlight-active",
  onHighlightClick: (id, position) => {
    console.log(`Clicked highlight ${id} at`, position);
    showToolbar(id, position);
  },
  onHighlightHover: (id, isHovering) => {
    console.log(`Highlight ${id} hover:`, isHovering);
  },
});

// Set active highlight programmatically
manager.setActiveHighlight("highlight-1");

// Clean up when done
manager.destroy();
```

## React Integration

For React applications, use the `useHighlighter` hook from the `/react` subpath. This hook provides a unified API for:

- Syncing highlight data to the DOM (adding, removing, updating marks)
- Managing hover states (grouping multi-segment highlights)
- Managing active/selected states
- Click and hover event callbacks

### Basic Usage

```tsx
import { useRef, useState, useEffect } from "react";
import { useHighlighter } from "@zsh-eng/text-highlighter/react";
import type { SyncableHighlight } from "@zsh-eng/text-highlighter/react";

// Extend SyncableHighlight with your app-specific fields
interface MyHighlight extends SyncableHighlight {
  color: string;
}

function ReaderPage({ highlights }: { highlights: MyHighlight[] }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { setActiveHighlight } = useHighlighter({
    containerRef: contentRef,
    highlights,
    contentReady: true, // Set to true when content is loaded
    className: "highlight",
    hoverClass: "highlight-hover",
    activeClass: "highlight-active",
    getAttributes: (h) => ({ "data-color": h.color }),
    onHighlightClick: (id, position) => {
      // Toggle active state on click
      setActiveId((prev) => (prev === id ? null : id));
    },
  });

  // Sync external active state to DOM
  useEffect(() => {
    setActiveHighlight(activeId);
  }, [activeId, setActiveHighlight]);

  return <div ref={contentRef} dangerouslySetInnerHTML={{ __html: content }} />;
}
```

### `UseHighlighterOptions`

| Option             | Type                               | Description                                                      |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| `containerRef`     | `RefObject<HTMLElement>`           | Ref to the container element                                     |
| `highlights`       | `T[]`                              | Array of highlights to sync to the DOM                           |
| `contentReady`     | `boolean`                          | Set to true when container content is loaded                     |
| `className`        | `string`                           | CSS class for highlight elements (default: `'text-highlight'`)   |
| `idAttribute`      | `string`                           | Data attribute for highlight ID (default: `'data-highlight-id'`) |
| `tagName`          | `string`                           | HTML tag for highlight elements (default: `'mark'`)              |
| `hoverClass`       | `string`                           | Class added on hover to all segments of a highlight              |
| `activeClass`      | `string`                           | Class added when a highlight is active/selected                  |
| `getAttributes`    | `(h: T) => Record<string, string>` | Map a highlight to additional DOM attributes                     |
| `onHighlightClick` | `(id, position) => void`           | Called when a highlight is clicked                               |
| `onHighlightHover` | `(id, isHovering) => void`         | Called when hover state changes                                  |

### `getAttributes` for Dynamic Updates

The `getAttributes` function is called for each highlight when syncing to the DOM. When the returned attributes change (e.g., after a color update), the DOM elements are automatically updated:

```tsx
// When highlight.color changes, the data-color attribute is updated
getAttributes: (h) => ({ "data-color": h.color });
```

## API Reference

### Types

```ts
/**
 * Represents a text highlight with position data and context for fallback matching.
 */
interface TextHighlight {
  /** Character offset in text-only content where highlight starts */
  startOffset: number;
  /** Character offset in text-only content where highlight ends */
  endOffset: number;
  /** The actual highlighted text */
  selectedText: string;
  /** Context before the highlight for fallback matching (~50 chars) */
  textBefore?: string;
  /** Context after the highlight for fallback matching (~50 chars) */
  textAfter?: string;
}

/**
 * Options for applying highlights to the DOM
 */
interface ApplyHighlightOptions {
  /** HTML tag name for the highlight element (default: 'mark') */
  tagName?: string;
  /** CSS class name(s) to add to the highlight element */
  className?: string;
  /** Custom attributes to set on the highlight element */
  attributes?: Record<string, string>;
}

/**
 * Position information for UI elements (e.g., toolbar positioning)
 */
interface SelectionPosition {
  x: number;
  y: number;
}

/**
 * Result of creating a highlight from a selection or range
 */
interface CreateHighlightResult {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  textBefore: string;
  textAfter: string;
}
```

### Functions

| Function                                                             | Description                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `createHighlightFromSelection(selection, container, contextLength?)` | Create highlight data from a browser Selection object      |
| `createHighlightFromRange(range, container, contextLength?)`         | Create highlight data from a DOM Range                     |
| `applyHighlight(container, highlight, options?)`                     | Apply a single highlight to the DOM. Returns `boolean`     |
| `applyHighlights(container, highlights, options?)`                   | Apply multiple highlights. Returns array of applied IDs    |
| `removeHighlight(container, selector)`                               | Remove highlights matching a CSS selector                  |
| `removeHighlightById(container, id)`                                 | Remove a highlight by its `data-highlight-id`              |
| `getSelectionPosition(selection)`                                    | Get `{x, y}` coordinates for positioning UI elements       |
| `getTextOffset(container, node, offset)`                             | Convert DOM position to text offset                        |
| `findRangeByTextOffset(container, startOffset, endOffset)`           | Convert text offsets back to a DOM Range                   |
| `verifyRangeText(range, expectedText)`                               | Verify a range contains the expected text                  |
| `wrapRangeWithHighlight(range, document, options?)`                  | Low-level function to wrap a Range with highlight elements |

## Key Concepts

### Text Offsets vs XPath

Traditional highlight libraries store DOM paths (XPath or CSS selectors) to locate highlighted text. This breaks when:

- The DOM structure changes (e.g., content re-renders)
- Elements are added/removed before the highlight
- The page is rendered differently on another device

**text-highlighter** uses character offsets in the text-only content. The offset `5` means "5 characters from the start of the container's text content", regardless of how that text is structured in the DOM.

### Block-Aware Wrapping

When a highlight spans multiple block elements (e.g., `<p>` tags), the library creates separate `<mark>` elements for each block rather than wrapping the entire range in a single element (which would produce invalid HTML).

```html
<!-- Selection spans "lo" in first paragraph and "Wor" in second -->
<p>Hel<mark data-highlight-id="1">lo</mark></p>
<p><mark data-highlight-id="1">Wor</mark>ld</p>
```

### Text Verification

Before applying a highlight, the library verifies that the text at the stored offsets matches the expected `selectedText`. This prevents applying highlights to wrong content if the underlying text has changed.

## License

MIT
