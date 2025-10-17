# EPUB Reader Web Application - Technical Specification

## Overview
A browser-based EPUB reader application that allows users to manage, view, and read EPUB books with customizable reading settings. This initial version focuses on core reading functionality with a clean, user-friendly interface.

## Tech Stack
- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite (Rolldown)
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui (Radix UI)
- **Storage**: IndexedDB
- **EPUB Parsing**: fflate (ZIP decompression) + custom XML/HTML parsing
- **State Management**: React hooks + Context API

---

## 1. File Management & Storage

### 1.1 Storage Strategy
**Decision: Store uncompressed EPUB files in IndexedDB**

**Rationale:**
- Faster access to individual chapters/resources without repeated decompression
- Easier to extract cover images for library display
- Better performance for reading experience
- Trade-off: More storage space, but acceptable given modern browser storage limits

### 1.2 IndexedDB Schema

#### Database Name: `epub-reader-db`
#### Version: 1

#### Object Stores:

**Store 1: `books`**
```typescript
interface Book {
  id: string;                    // UUID
  title: string;
  author: string;
  coverImage?: string;           // Base64 data URL or blob URL
  addedDate: number;             // Timestamp
  lastOpenedDate?: number;       // Timestamp
  metadata: {
    publisher?: string;
    publishDate?: string;
    language?: string;
    identifier?: string;         // ISBN, etc.
    description?: string;
  };
  manifest: ManifestItem[];      // All files in the EPUB
  spine: SpineItem[];            // Reading order
  toc: TOCItem[];               // Table of contents
  rootPath: string;              // Path to content.opf location
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface SpineItem {
  idref: string;                 // References manifest item id
  linear?: boolean;
  properties?: string;
}

interface TOCItem {
  id: string;
  label: string;
  href: string;                  // Fragment identifier (#chapter-1)
  children?: TOCItem[];
}
```

**Store 2: `book-files`**
```typescript
interface BookFile {
  bookId: string;                // Foreign key to books.id
  path: string;                  // File path within EPUB
  content: string | Blob;        // Text content or binary blob
  mediaType: string;
  
  // Composite key: [bookId, path]
}
```

**Store 3: `reading-progress`**
```typescript
interface ReadingProgress {
  bookId: string;                // Primary key
  currentSpineIndex: number;     // Current chapter in spine
  currentCfi?: string;           // EPUB CFI (optional, for future)
  scrollPosition: number;        // For scroll mode
  pageNumber?: number;           // For paginated mode
  totalPages?: number;           // Cached page count
  lastReadDate: number;
  readingSettings: ReadingSettings;
}

interface ReadingSettings {
  mode: 'paginated' | 'scroll';
  fontSize: number;              // 12-24px range
  lineHeight: number;            // 1.2-2.0 range
  theme: 'light' | 'dark' | 'sepia';
}
```

### 1.3 Storage Operations

**Key Functions:**
- `saveBook(file: File): Promise<string>` - Parse and store EPUB
- `getBook(bookId: string): Promise<Book>` - Retrieve book metadata
- `getBookFile(bookId: string, path: string): Promise<BookFile>` - Get specific file
- `deleteBook(bookId: string): Promise<void>` - Remove book and all files
- `getAllBooks(): Promise<Book[]>` - List all books
- `updateProgress(bookId: string, progress: Partial<ReadingProgress>): Promise<void>`
- `getProgress(bookId: string): Promise<ReadingProgress | null>`

---

## 2. EPUB Parsing

### 2.1 EPUB Structure
EPUB files are ZIP archives containing:
- `META-INF/container.xml` - Points to package document
- `*.opf` (package document) - Metadata, manifest, spine
- `toc.ncx` or `nav.xhtml` - Table of contents
- Content files (XHTML, CSS, images, fonts)

### 2.2 Parsing Pipeline

**Step 1: Extract ZIP**
```typescript
import { unzip } from 'fflate';

async function extractEPUB(file: File): Promise<Map<string, Uint8Array>> {
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  
  return new Promise((resolve, reject) => {
    unzip(uint8, (err, data) => {
      if (err) reject(err);
      else resolve(new Map(Object.entries(data)));
    });
  });
}
```

**Step 2: Parse container.xml**
- Extract path to .opf file (package document)

**Step 3: Parse .opf file**
- Extract metadata (title, author, publisher, etc.)
- Parse manifest (all resources)
- Parse spine (reading order)
- Extract cover image reference

**Step 4: Parse TOC**
- Parse `toc.ncx` (EPUB 2) or `nav.xhtml` (EPUB 3)
- Build hierarchical table of contents

**Step 5: Process Resources**
- Decode text files (XHTML, CSS) as UTF-8
- Store binary files (images) as Blobs
- Extract and process cover image

### 2.3 Content Processing

**HTML Sanitization:**
- Strip `<script>` tags for security
- Remove embedded fonts (using system fonts only)
- Preserve structure: headings, paragraphs, images, lists, tables
- Keep classes for styling (may be needed for layout)

**Image Handling:**
- Convert relative paths to absolute
- Store images as Blobs
- Create object URLs when rendering

**CSS Handling:**
- For v1: Ignore book CSS, apply own styling
- Keep structure for future enhancement

---

## 3. User Interface

### 3.1 Application Routes

```
/                     -> Library Page
/reader/:bookId       -> Reader Page
```

### 3.2 Library Page

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  EPUB Reader                    [Add Book] [⚙ Settings] │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  📚 My Library                          [Grid] [List]     │
│                                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ Cover  │ │ Cover  │ │ Cover  │ │ Cover  │           │
│  │ Image  │ │ Image  │ │ Image  │ │ Image  │           │
│  │        │ │        │ │        │ │        │           │
│  └────────┘ └────────┘ └────────┘ └────────┘           │
│  Book Title  Book Title Book Title Book Title           │
│  Author      Author     Author     Author               │
│                                                           │
│  [⋮]         [⋮]        [⋮]        [⋮]                  │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**Components:**
- `LibraryHeader` - Title, add book button, settings
- `BookGrid` / `BookList` - Display books
- `BookCard` - Individual book item
  - Cover image (with fallback)
  - Title
  - Author
  - Progress indicator (optional)
  - Context menu (open, delete)
- `AddBookDialog` - File upload interface
- `EmptyState` - When no books exist

**Features:**
- Grid/List view toggle
- Sort by: Date Added, Title, Author, Last Read
- Search/filter books
- Click to open book

### 3.3 Reader Page

**Layout (Paginated Mode):**
```
┌─────────────────────────────────────────────────────────┐
│  [← Back]  Book Title - Chapter Name    [TOC] [⚙ Aa]   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│                                                           │
│                                                           │
│              Chapter content here...                      │
│              Lorem ipsum dolor sit amet,                  │
│              consectetur adipiscing elit.                 │
│                                                           │
│                                                           │
│                                                           │
│                                                           │
├─────────────────────────────────────────────────────────┤
│        [←]        Page 24 of 156         [→]             │
└─────────────────────────────────────────────────────────┘
```

**Layout (Scroll Mode):**
```
┌─────────────────────────────────────────────────────────┐
│  [← Back]  Book Title - Chapter Name    [TOC] [⚙ Aa]   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Chapter content here...                                  │
│  Lorem ipsum dolor sit amet, consectetur...               │
│  [Scrollable content]                                     │
│  ...continues...                                          │
│                                                           │
├─────────────────────────────────────────────────────────┤
│        [← Prev Chapter] [Next Chapter →]                 │
└─────────────────────────────────────────────────────────┘
```

**Components:**

1. **ReaderHeader**
   - Back button (to library)
   - Book title + current chapter
   - TOC button
   - Settings button (font size, line height, mode)

2. **ReaderContent**
   - Renders current chapter XHTML
   - Applies custom styles
   - Handles pagination or scrolling

3. **ReaderFooter**
   - Paginated mode: Page navigation, page counter
   - Scroll mode: Chapter navigation

4. **TableOfContents (Sidebar/Dialog)**
   - Hierarchical chapter list
   - Click to jump to chapter
   - Highlight current chapter

5. **ReaderSettings (Popover/Dialog)**
   - Font size slider (12-24px)
   - Line height slider (1.2-2.0)
   - Mode toggle (Paginated/Scroll)
   - Theme selector (Light/Dark/Sepia) - optional for v1

**Typography:**
- Use system serif font stack:
  ```css
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  ```
- Base font size: 16px (adjustable)
- Headings: Relative sizing based on semantic level
  - H1: 2em (adjustable)
  - H2: 1.5em
  - H3: 1.25em
  - H4-H6: 1em (with font-weight variations)

---

## 4. Reading Modes

### 4.1 Paginated Mode

**Concept:**
- Divide content into fixed-size "pages"
- Users navigate with prev/next buttons or arrow keys
- Calculate page count dynamically

**Implementation Strategy:**

**Option A: CSS Multi-Column Layout**
```typescript
const contentEl = document.getElementById('reader-content');
contentEl.style.columnWidth = `${pageWidth}px`;
contentEl.style.columnGap = '40px';
contentEl.style.height = `${pageHeight}px`;

// Calculate pages
const scrollWidth = contentEl.scrollWidth;
const pageCount = Math.ceil(scrollWidth / pageWidth);

// Navigate
const goToPage = (pageNum: number) => {
  contentEl.scrollLeft = (pageNum - 1) * (pageWidth + 40);
};
```

**Option B: CSS Paged Media (future consideration)**
- More complex, better book-like experience
- Currently limited browser support

**Features:**
- Smooth page transitions
- Page counter
- Keyboard navigation (arrow keys, space)
- Touch/swipe support
- Remember page position

**Challenges:**
- Images spanning multiple pages
- Consistent page breaks
- Dynamic content height
- Recalculation on font size change

### 4.2 Scroll Mode

**Concept:**
- Traditional web scrolling
- One chapter at a time
- Navigate between chapters with buttons

**Implementation:**
```typescript
const ChapterContent = ({ chapter, settings }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Restore scroll position
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = savedScrollPosition;
    }
  }, [chapter]);
  
  useEffect(() => {
    // Save scroll position periodically
    const handleScroll = debounce(() => {
      saveProgress(bookId, {
        scrollPosition: scrollContainerRef.current?.scrollTop
      });
    }, 500);
    
    scrollContainerRef.current?.addEventListener('scroll', handleScroll);
    return () => scrollContainerRef.current?.removeEventListener('scroll', handleScroll);
  }, []);
  
  return (
    <div ref={scrollContainerRef} className="scroll-container">
      <div dangerouslySetInnerHTML={{ __html: sanitizedHTML }} />
    </div>
  );
};
```

**Features:**
- Natural scrolling behavior
- Scroll position persistence
- Chapter navigation
- Keyboard navigation (arrow keys to next/prev chapter at boundaries)

---

## 5. Reading Settings

### 5.1 Font Size Control

**Range:** 12px - 24px (default: 16px)

**Implementation:**
```typescript
const applyFontSize = (size: number) => {
  document.documentElement.style.setProperty('--reader-font-size', `${size}px`);
};
```

**CSS:**
```css
.reader-content {
  font-size: var(--reader-font-size, 16px);
}

.reader-content h1 {
  font-size: calc(var(--reader-font-size, 16px) * 2);
}

.reader-content h2 {
  font-size: calc(var(--reader-font-size, 16px) * 1.5);
}

/* etc. */
```

**UI Component:**
- Slider with +/- buttons
- Live preview
- Reset button

### 5.2 Line Height Control

**Range:** 1.2 - 2.0 (default: 1.6)

**Implementation:**
```typescript
const applyLineHeight = (height: number) => {
  document.documentElement.style.setProperty('--reader-line-height', height.toString());
};
```

**CSS:**
```css
.reader-content {
  line-height: var(--reader-line-height, 1.6);
}
```

### 5.3 Mode Toggle

**Switch between Paginated and Scroll modes**

**Considerations:**
- When switching modes, maintain chapter position
- Recalculate pages when switching to paginated
- Update progress tracking
- Persist user preference

### 5.4 Settings Persistence

**Per-book settings:**
- Stored in `reading-progress` table
- Loaded when opening book
- Applied immediately

**Global defaults:**
- Store in localStorage
- Applied to new books

---

## 6. Core Features Implementation

### 6.1 Adding Books

**User Flow:**
1. Click "Add Book" button
2. Select EPUB file from file picker
3. Show loading indicator
4. Parse and extract EPUB
5. Store in IndexedDB
6. Display in library
7. Show success notification

**Component:**
```typescript
const AddBookButton = () => {
  const handleFileSelect = async (file: File) => {
    try {
      setLoading(true);
      const bookId = await parseAndSaveEPUB(file);
      toast.success('Book added successfully!');
      navigate(`/reader/${bookId}`);
    } catch (error) {
      toast.error('Failed to add book');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Button onClick={() => fileInputRef.current?.click()}>
      <Plus /> Add Book
    </Button>
  );
};
```

**Validation:**
- Check file extension (.epub)
- Verify ZIP structure
- Validate container.xml exists
- Handle corrupt files gracefully

### 6.2 Displaying Book Covers

**Cover Image Extraction:**

Priority order:
1. `<meta name="cover" content="cover-image-id">` in OPF
2. `<manifest>` item with `properties="cover-image"`
3. First image in manifest with "cover" in filename
4. First image in manifest

**Processing:**
```typescript
const extractCoverImage = async (
  bookFiles: Map<string, Uint8Array>,
  manifest: ManifestItem[],
  metadata: any
): Promise<string | undefined> => {
  // Find cover image reference
  const coverItem = findCoverInManifest(manifest, metadata);
  
  if (!coverItem) return undefined;
  
  // Get image file
  const imageData = bookFiles.get(coverItem.href);
  if (!imageData) return undefined;
  
  // Convert to base64 data URL
  const base64 = btoa(
    Array.from(imageData)
      .map(byte => String.fromCharCode(byte))
      .join('')
  );
  
  return `data:${coverItem.mediaType};base64,${base64}`;
};
```

**Display:**
- Fixed aspect ratio (3:4 typical book ratio)
- Object-fit: cover
- Fallback: Generic book icon with title initial

### 6.3 Opening and Reading Books

**Navigation Flow:**
```
Library → Click Book → Reader Page
```

**Reader Initialization:**
1. Load book metadata from IndexedDB
2. Check reading progress
3. Load last-read chapter (or first chapter)
4. Apply saved settings
5. Render content
6. Initialize navigation

**Content Rendering:**
```typescript
const ReaderContent = ({ bookId, spineIndex, settings }) => {
  const [content, setContent] = useState('');
  
  useEffect(() => {
    const loadChapter = async () => {
      const book = await getBook(bookId);
      const spineItem = book.spine[spineIndex];
      const manifestItem = book.manifest.find(m => m.id === spineItem.idref);
      
      const file = await getBookFile(bookId, manifestItem.href);
      const processedHTML = await processChapterHTML(
        file.content,
        book,
        manifestItem.href
      );
      
      setContent(processedHTML);
    };
    
    loadChapter();
  }, [bookId, spineIndex]);
  
  return (
    <div 
      className="reader-content"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
};
```

**Content Processing:**
- Resolve relative image paths
- Strip unsafe content
- Apply CSS resets
- Insert base styles

### 6.4 Navigation

**Chapter Navigation:**
- Previous/Next chapter buttons
- Keyboard shortcuts:
  - Left/Right arrows (paginated mode: pages, scroll mode: chapters)
  - Up/Down arrows (scroll mode: scroll)
  - Space (next page/screen)
  - Home/End (first/last chapter)

**TOC Navigation:**
- Click TOC item → Jump to chapter
- Update progress

**Progress Tracking:**
- Auto-save every 5 seconds
- Save on chapter change
- Save on browser close (beforeunload)

---

## 7. Data Flow Architecture

### 7.1 Context Providers

**LibraryContext:**
```typescript
interface LibraryContextType {
  books: Book[];
  loading: boolean;
  addBook: (file: File) => Promise<string>;
  deleteBook: (bookId: string) => Promise<void>;
  refreshLibrary: () => Promise<void>;
}
```

**ReaderContext:**
```typescript
interface ReaderContextType {
  book: Book | null;
  currentSpineIndex: number;
  progress: ReadingProgress | null;
  settings: ReadingSettings;
  goToChapter: (index: number) => void;
  goToNextChapter: () => void;
  goToPreviousChapter: () => void;
  updateSettings: (settings: Partial<ReadingSettings>) => void;
  updateProgress: (progress: Partial<ReadingProgress>) => void;
}
```

### 7.2 Service Layer

**File Structure:**
```
src/
  services/
    indexeddb.ts       - IndexedDB wrapper
    epub-parser.ts     - EPUB parsing logic
    content-processor.ts - HTML sanitization
    storage.ts         - Storage operations
```

---

## 8. Styling Strategy

### 8.1 Reader Content Styles

**Reset Book Styles:**
```css
.reader-content {
  /* Typography */
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  font-size: var(--reader-font-size, 16px);
  line-height: var(--reader-line-height, 1.6);
  color: var(--text-color);
  
  /* Reset */
  all: revert;
}

.reader-content * {
  font-family: inherit !important;
  line-height: inherit;
}

/* Headings */
.reader-content h1,
.reader-content h2,
.reader-content h3,
.reader-content h4,
.reader-content h5,
.reader-content h6 {
  font-family: inherit;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

/* Paragraphs */
.reader-content p {
  margin-bottom: 1em;
  text-align: justify;
  hyphens: auto;
}

/* Images */
.reader-content img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}

/* Lists */
.reader-content ul,
.reader-content ol {
  margin: 1em 0;
  padding-left: 2em;
}

/* Blockquotes */
.reader-content blockquote {
  border-left: 4px solid var(--border-color);
  padding-left: 1em;
  margin: 1em 0;
  font-style: italic;
}
```

### 8.2 Responsive Design

**Breakpoints:**
- Mobile: < 640px (single column, smaller margins)
- Tablet: 640px - 1024px (comfortable reading width)
- Desktop: > 1024px (max-width content, centered)

**Reading Width:**
- Optimal: 60-75 characters per line
- Max-width: 800px for readability

---

## 9. Performance Considerations

### 9.1 Optimization Strategies

**Lazy Loading:**
- Load chapters on-demand
- Cache current, previous, and next chapter
- Unload distant chapters from memory

**Image Optimization:**
- Use object URLs for images (not base64 in HTML)
- Load images lazily
- Revoke object URLs when unmounting

**IndexedDB:**
- Use indexes for faster queries
- Batch operations when possible
- Cache frequently accessed data in memory

**Rendering:**
- Virtualize long chapters in scroll mode
- Debounce font/layout changes
- Use CSS transforms for page transitions

### 9.2 Storage Limits

**Quota Management:**
- Request persistent storage
- Estimate storage before adding books
- Show storage usage to users
- Implement book deletion

---

## 10. Error Handling

### 10.1 User-Facing Errors

**Book Import Errors:**
- Invalid file format
- Corrupted EPUB
- Missing required files
- Parsing errors

**Storage Errors:**
- Quota exceeded
- IndexedDB unavailable
- Permission denied

**Reading Errors:**
- Chapter not found
- Image loading failure
- Rendering issues

### 10.2 Error UI

**Toast Notifications:**
- Success: Book added, settings saved
- Error: Import failed, storage full
- Info: Loading progress

**Fallbacks:**
- Missing covers → Generic icon
- Missing chapters → Error message
- Failed images → Placeholder

---

## 11. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Library** ||
| Enter | Open selected book |
| Delete | Delete selected book |
| **Reader** ||
| ← | Previous page/chapter |
| → | Next page/chapter |
| ↑ | Scroll up (scroll mode) |
| ↓ | Scroll down (scroll mode) |
| Space | Next page/screen |
| Shift+Space | Previous page/screen |
| Home | First chapter |
| End | Last chapter |
| T | Toggle TOC |
| A | Toggle settings |
| Esc | Close dialogs, back to library |

---

## 12. Future Enhancements (Out of Scope for v1)

- [ ] Bookmarks and highlights
- [ ] Notes and annotations
- [ ] Full-text search within books
- [ ] Reading statistics and goals
- [ ] Collections/shelves
- [ ] Cloud sync
- [ ] EPUB font support
- [ ] Custom CSS themes
- [ ] Text-to-speech
- [ ] Dictionary integration
- [ ] Night mode with warm lighting
- [ ] Export highlights
- [ ] Social features (sharing quotes)

---

## 13. Testing Strategy

### 13.1 Test EPUB Files

**Required test cases:**
- EPUB 2.0 format
- EPUB 3.0 format
- Books with images
- Books with complex layouts
- Books with different languages
- Large books (> 1000 pages)
- Small books (< 50 pages)

### 13.2 Browser Testing

**Target browsers:**
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

**Mobile browsers:**
- iOS Safari
- Chrome Android

### 13.3 Unit Tests

**Key areas:**
- EPUB parsing
- Content sanitization
- Path resolution
- Storage operations
- Page calculation

---

## 14. Development Phases

### Phase 1: Foundation (Week 1)
- [ ] IndexedDB service layer
- [ ] EPUB parser
- [ ] Basic file upload
- [ ] Store and retrieve books

### Phase 2: Library (Week 1-2)
- [ ] Library page UI
- [ ] Book grid display
- [ ] Cover image extraction
- [ ] Add/delete books
- [ ] Empty state

### Phase 3: Reader - Scroll Mode (Week 2-3)
- [ ] Reader page layout
- [ ] Chapter rendering
- [ ] Content processing
- [ ] Chapter navigation
- [ ] Progress tracking
- [ ] TOC sidebar

### Phase 4: Reader - Paginated Mode (Week 3-4)
- [ ] Page calculation
- [ ] Page navigation
- [ ] Page transitions
- [ ] Page counter

### Phase 5: Settings & Polish (Week 4-5)
- [ ] Font size control
- [ ] Line height control
- [ ] Mode toggle
- [ ] Settings persistence
- [ ] Keyboard shortcuts
- [ ] Responsive design
- [ ] Error handling
- [ ] Loading states

### Phase 6: Testing & Refinement (Week 5-6)
- [ ] Cross-browser testing
- [ ] Performance optimization
- [ ] Bug fixes
- [ ] Documentation
- [ ] Accessibility improvements

---

## 15. File Structure (Proposed)

```
src/
  components/
    library/
      BookCard.tsx
      BookGrid.tsx
      LibraryHeader.tsx
      AddBookDialog.tsx
      EmptyState.tsx
    reader/
      ReaderHeader.tsx
      ReaderContent.tsx
      ReaderFooter.tsx
      TableOfContents.tsx
      ReaderSettings.tsx
      PaginatedReader.tsx
      ScrollReader.tsx
    ui/
      [shadcn components]
  
  contexts/
    LibraryContext.tsx
    ReaderContext.tsx
  
  services/
    indexeddb.ts
    epub-parser.ts
    content-processor.ts
    storage.ts
  
  types/
    epub.ts
    book.ts
    progress.ts
  
  utils/
    sanitize.ts
    path-resolver.ts
    debounce.ts
  
  hooks/
    useBooks.ts
    useReader.ts
    useReadingProgress.ts
  
  pages/
    Library.tsx
    Reader.tsx
  
  App.tsx
  main.tsx
```

---

## Conclusion

This specification provides a comprehensive roadmap for building a functional EPUB reader web application. The focus is on core reading functionality with a clean, performant user experience. The modular architecture allows for future enhancements while maintaining simplicity in the initial version.

**Key Success Metrics:**
- Books load in < 2 seconds
- Smooth page/chapter transitions
- Responsive UI on all screen sizes
- Reliable storage and progress tracking
- Intuitive navigation and controls