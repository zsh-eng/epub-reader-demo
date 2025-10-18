# Reader Component Refactoring Specification

## Overview

This document outlines a comprehensive refactoring plan for the `Reader.tsx` component to improve code organization, maintainability, testability, and readability. The component is currently ~580 lines with multiple responsibilities mixed together.

**Goal**: Break down the monolithic Reader component into focused, reusable custom hooks and smaller UI components.

---

## Phase 1: Extract Custom Hooks

### 1.1 Create `useBookLoader` Hook

**File**: `src/hooks/useBookLoader.ts`

**Purpose**: Handle book loading, initialization, and reading progress restoration.

**Responsibilities**:

- Load book data from database
- Handle book not found errors
- Load and restore reading progress
- Manage loading state

**Interface**:

```typescript
interface UseBookLoaderReturn {
  book: Book | null;
  currentChapterIndex: number;
  setCurrentChapterIndex: (index: number) => void;
  isLoading: boolean;
  lastScrollProgress: React.MutableRefObject<number>;
}

function useBookLoader(bookId: string | undefined): UseBookLoaderReturn;
```

**Notes**:

- Should handle navigation to home page on error
- Should restore scroll position after content loads
- Use `requestAnimationFrame` instead of `setTimeout` for scroll restoration timing

---

### 1.2 Create `useChapterContent` Hook

**File**: `src/hooks/useChapterContent.ts`

**Purpose**: Handle chapter content loading and resource management.

**Responsibilities**:

- Load chapter content based on current spine index
- Process embedded resources (images, stylesheets, fonts)
- Manage resource URL cleanup
- Handle content loading errors

**Interface**:

```typescript
interface UseChapterContentReturn {
  chapterContent: string;
  resourceUrlsRef: React.MutableRefObject<Map<string, string>>;
}

function useChapterContent(
  book: Book | null,
  bookId: string | undefined,
  currentChapterIndex: number,
): UseChapterContentReturn;
```

**Notes**:

- Must cleanup resource URLs on unmount and chapter change
- Should reset scroll position when chapter changes
- Handle manifest/spine item not found gracefully

---

### 1.3 Create `useReadingProgress` Hook

**File**: `src/hooks/useReadingProgress.ts`

**Purpose**: Auto-save reading progress periodically.

**Responsibilities**:

- Calculate scroll progress
- Save progress at regular intervals (every 3 seconds)
- Only save when progress changes significantly (>1%)
- Handle NaN scroll progress values

**Interface**:

```typescript
function useReadingProgress(
  bookId: string | undefined,
  book: Book | null,
  currentChapterIndex: number,
  lastScrollProgress: React.MutableRefObject<number>,
): void;
```

**Notes**:

- Should use `setInterval` for periodic saves
- Must cleanup interval on unmount
- Should compare against last saved progress to avoid unnecessary saves

---

### 1.4 Create `useTextSelection` Hook

**File**: `src/hooks/useTextSelection.ts`

**Purpose**: Handle text selection and highlight toolbar display.

**Responsibilities**:

- Detect text selection within reader content
- Calculate toolbar position
- Show/hide highlight toolbar
- Handle selection clearing

**Interface**:

```typescript
interface UseTextSelectionReturn {
  showHighlightToolbar: boolean;
  toolbarPosition: { x: number; y: number };
  currentSelection: Selection | null;
  handleHighlightColorSelect: (color: string) => void;
  handleCloseHighlightToolbar: () => void;
}

function useTextSelection(
  contentRef: React.RefObject<HTMLDivElement>,
): UseTextSelectionReturn;
```

**Notes**:

- Use delay (100ms) to prevent flickering during drag selection
- Only show toolbar for selections within content area
- Clear selection after creating highlight
- Handle cleanup of timeout on unmount

---

### 1.5 Create `useChapterNavigation` Hook

**File**: `src/hooks/useChapterNavigation.ts`

**Purpose**: Handle all chapter navigation logic.

**Responsibilities**:

- Navigate to previous/next chapter
- Navigate to chapter by href (from TOC)
- Save progress on chapter change
- Scroll to top on navigation
- Keyboard navigation (arrow keys)

**Interface**:

```typescript
interface UseChapterNavigationReturn {
  goToPreviousChapter: () => Promise<void>;
  goToNextChapter: () => Promise<void>;
  goToChapterByHref: (href: string) => Promise<void>;
}

function useChapterNavigation(
  book: Book | null,
  bookId: string | undefined,
  currentChapterIndex: number,
  setCurrentChapterIndex: (index: number) => void,
): UseChapterNavigationReturn;
```

**Notes**:

- Should use the consolidated `saveCurrentProgress` utility
- Must check bounds before navigating
- Scroll behavior should be 'instant' on chapter change
- Keyboard handler should ignore events from input/textarea elements

---

### 1.6 Create `useKeyboardNavigation` Hook

**File**: `src/hooks/useKeyboardNavigation.ts`

**Purpose**: Handle keyboard shortcuts for navigation.

**Responsibilities**:

- Listen for arrow key presses
- Ignore keys when typing in input fields
- Trigger navigation callbacks

**Interface**:

```typescript
function useKeyboardNavigation(
  goToPreviousChapter: () => void,
  goToNextChapter: () => void,
): void;
```

**Notes**:

- Should check if event target is HTMLInputElement or HTMLTextAreaElement
- Prevent default browser behavior for arrow keys
- Cleanup event listener on unmount

---

## Phase 2: Create Utility Functions

### 2.1 Create Progress Utilities

**File**: `src/lib/progress-utils.ts`

**Purpose**: Centralize progress saving logic to avoid duplication.

**Functions**:

```typescript
export async function saveCurrentProgress(
  bookId: string,
  currentChapterIndex: number,
  scrollProgress: number = 0,
): Promise<void>;

export function calculateScrollProgress(): number;
```

**Usage**: Replace duplicated progress-saving code in:

- `goToPreviousChapter`
- `goToNextChapter`
- `goToChapterByHref`
- Auto-save interval

**Notes**:

- Should handle NaN values gracefully
- Update lastRead timestamp
- Use consistent progress ID structure

---

### 2.2 Create TOC Utilities

**File**: `src/lib/toc-utils.ts`

**Purpose**: Simplify TOC navigation and chapter title resolution.

**Functions**:

```typescript
export function findTOCItemByHref(
  items: TOCItem[],
  targetHref: string,
): TOCItem | null;

export function getChapterTitleFromSpine(
  book: Book,
  spineIndex: number,
): string;

export function findSpineIndexByHref(book: Book, href: string): number | null;
```

**Notes**:

- `findTOCItemByHref` should search recursively through children
- Handle both full path and filename matching
- Return empty string if chapter title not found

---

### 2.3 Create Scroll Restoration Hook

**File**: `src/hooks/useScrollRestoration.ts`

**Purpose**: Properly restore scroll position without timing issues.

**Interface**:

```typescript
function useScrollRestoration(scrollProgress: number, isReady: boolean): void;
```

**Implementation**:

- Use `requestAnimationFrame` instead of `setTimeout`
- Wait for content to be ready before restoring
- Calculate scroll position based on document height

---

## Phase 3: Extract UI Components

### 3.1 Create `ReaderHeader` Component

**File**: `src/components/Reader/ReaderHeader.tsx`

**Purpose**: Display book title, chapter info, and navigation controls.

**Props**:

```typescript
interface ReaderHeaderProps {
  book: Book;
  currentChapterTitle: string;
  currentChapterIndex: number;
  totalChapters: number;
  onToggleTOC: () => void;
  onBackToLibrary: () => void;
}
```

**Content**:

- Hamburger menu button (TOC trigger)
- Back to library button
- Book title
- Current chapter title
- Chapter progress (x/y)

---

### 3.2 Create `TableOfContents` Component

**File**: `src/components/Reader/TableOfContents.tsx`

**Purpose**: Display table of contents in a sheet/drawer.

**Props**:

```typescript
interface TableOfContentsProps {
  toc: TOCItem[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (href: string) => void;
}
```

**Features**:

- Recursive rendering of TOC items
- Indentation based on nesting level
- Click to navigate
- Close sheet after navigation

**Helper**:

```typescript
function TOCItems({
  items: TOCItem[],
  level: number,
  onNavigate: (href: string) => void
}): JSX.Element
```

---

### 3.3 Create `NavigationButtons` Component

**File**: `src/components/Reader/NavigationButtons.tsx`

**Purpose**: Display previous/next chapter navigation buttons.

**Props**:

```typescript
interface NavigationButtonsProps {
  currentChapterIndex: number;
  totalChapters: number;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;
  onPrevious: () => void;
  onNext: () => void;
}
```

**Content**:

- Previous button with disabled state
- Current chapter indicator
- Next button with disabled state

---

### 3.4 Create `LoadingSpinner` Component

**File**: `src/components/Reader/LoadingSpinner.tsx`

**Purpose**: Display loading state for book loading.

**Props**: None (can be reusable)

**Content**:

- Centered spinner animation
- "Loading book..." text

---

## Phase 4: Type Safety Improvements

### 4.1 Create Reader Types File

**File**: `src/types/reader.types.ts`

**Purpose**: Centralize Reader-related types.

**Types**:

```typescript
export interface ChapterNavigationState {
  currentIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  totalChapters: number;
}

export interface HighlightState {
  showToolbar: boolean;
  position: { x: number; y: number };
  selection: Selection | null;
}

export interface ReaderState {
  book: Book | null;
  isLoading: boolean;
  chapterContent: string;
  isTOCOpen: boolean;
}

export interface ChapterInfo {
  title: string;
  index: number;
  href: string;
  hasNext: boolean;
  hasPrevious: boolean;
}
```

---

## Phase 5: Error Handling Improvements

### 5.1 Create `useReaderError` Hook

**File**: `src/hooks/useReaderError.ts`

**Purpose**: Centralize error handling and user feedback.

**Interface**:

```typescript
interface UseReaderErrorReturn {
  handleError: (
    message: string,
    error?: unknown,
    shouldNavigate?: boolean,
  ) => void;
}

function useReaderError(): UseReaderErrorReturn;
```

**Notes**:

- **IMPORTANT**: Do NOT include `toast` in the dependency array (causes infinite re-renders)
- Should log errors to console
- Display toast notification
- Optionally navigate to home page

---

## Phase 6: Final Refactored Structure

### 6.1 Refactored `Reader.tsx`

**File**: `src/components/Reader.tsx`

**Structure** (~80 lines vs 580 lines):

```typescript
export function Reader() {
  // Route params
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Refs
  const contentRef = useRef<HTMLDivElement>(null);

  // Local state (minimal)
  const [isTOCOpen, setIsTOCOpen] = useState(false);

  // Custom hooks (all complex logic)
  const { book, currentChapterIndex, setCurrentChapterIndex, isLoading, lastScrollProgress }
    = useBookLoader(bookId);

  const { chapterContent } = useChapterContent(book, bookId, currentChapterIndex);

  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar
  } = useTextSelection(contentRef);

  const { goToPreviousChapter, goToNextChapter, goToChapterByHref }
    = useChapterNavigation(book, bookId, currentChapterIndex, setCurrentChapterIndex);

  useReadingProgress(bookId, book, currentChapterIndex, lastScrollProgress);
  useKeyboardNavigation(goToPreviousChapter, goToNextChapter);

  // Early returns
  if (isLoading) return <LoadingSpinner />;
  if (!book) return null;

  // Derived state
  const currentChapterTitle = getChapterTitleFromSpine(book, currentChapterIndex);
  const navigationState: ChapterNavigationState = {
    currentIndex: currentChapterIndex,
    hasPrevious: currentChapterIndex > 0,
    hasNext: currentChapterIndex < book.spine.length - 1,
    totalChapters: book.spine.length,
  };

  // Render
  return (
    <div className="flex flex-col bg-white">
      <ReaderHeader
        book={book}
        currentChapterTitle={currentChapterTitle}
        currentChapterIndex={currentChapterIndex}
        totalChapters={book.spine.length}
        onToggleTOC={() => setIsTOCOpen(true)}
        onBackToLibrary={() => navigate("/")}
      />

      <TableOfContents
        toc={book.toc}
        isOpen={isTOCOpen}
        onOpenChange={setIsTOCOpen}
        onNavigate={goToChapterByHref}
      />

      <ReaderContent
        content={chapterContent}
        chapterIndex={currentChapterIndex}
        ref={contentRef}
      />

      {showHighlightToolbar && (
        <HighlightToolbar
          position={toolbarPosition}
          onColorSelect={handleHighlightColorSelect}
          onClose={handleCloseHighlightToolbar}
        />
      )}

      <NavigationButtons
        {...navigationState}
        onPrevious={goToPreviousChapter}
        onNext={goToNextChapter}
      />
    </div>
  );
}
```

---

## Implementation Order

Implement in this order to minimize breaking changes:

1. **Phase 2**: Create utility functions (progress-utils, toc-utils)
2. **Phase 4**: Create type definitions
3. **Phase 5**: Create error handling hook
4. **Phase 1.2**: Extract `useChapterContent` (least dependent)
5. **Phase 1.3**: Extract `useReadingProgress`
6. **Phase 1.4**: Extract `useTextSelection`
7. **Phase 1.6**: Extract `useKeyboardNavigation`
8. **Phase 1.5**: Extract `useChapterNavigation`
9. **Phase 1.1**: Extract `useBookLoader`
10. **Phase 3**: Extract UI components (LoadingSpinner, NavigationButtons, TableOfContents, ReaderHeader)
11. **Phase 6**: Refactor main Reader component to use all hooks/components

---

## Benefits Summary

1. **Separation of Concerns**: Each hook/component has a single, clear responsibility
2. **Reusability**: Hooks can be reused in other components or tests
3. **Testability**: Much easier to unit test isolated hooks and components
4. **Readability**: Main component is ~80 lines instead of 580 lines
5. **Maintainability**: Changes are localized to specific hooks/components
6. **Type Safety**: Better TypeScript inference and explicit interfaces
7. **Performance**: Easier to optimize specific parts (memoization, code splitting)
8. **Developer Experience**: Easier to onboard new developers and understand code flow

---

## Testing Strategy

After refactoring, create tests for:

1. **Unit tests for hooks**:
   - `useBookLoader.test.ts`
   - `useChapterContent.test.ts`
   - `useReadingProgress.test.ts`
   - `useTextSelection.test.ts`
   - `useChapterNavigation.test.ts`

2. **Unit tests for utilities**:
   - `progress-utils.test.ts`
   - `toc-utils.test.ts`

3. **Integration tests**:
   - Full Reader component flow
   - Navigation between chapters
   - Progress saving and restoration

---

## Migration Notes

- Ensure all existing functionality is preserved
- Test thoroughly after each phase
- Update any components that import Reader types
- Check for any performance regressions
- Update documentation/comments as needed

---

## Future Enhancements

After refactoring, these features will be easier to add:

1. Bookmarks functionality (new hook: `useBookmarks`)
2. Annotations/notes (new hook: `useAnnotations`)
3. Search within book (new hook: `useBookSearch`)
4. Reading statistics (extend `useReadingProgress`)
5. Multiple reading themes (new hook: `useReaderTheme`)
6. Font size/spacing controls (new hook: `useReaderSettings`)
