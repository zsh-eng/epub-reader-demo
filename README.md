# EPUB Reader Demo

A modern web-based EPUB reader built with React, TypeScript, and DexieJS (IndexedDB).

## Features

- 📚 Add EPUB books via drag-and-drop or file picker
- 🖼️ Automatic cover image extraction and display
- 💾 Local storage using IndexedDB (no server required)
- 🎨 Clean, modern UI with Tailwind CSS
- 📱 Responsive design

## Getting Started

### Prerequisites

- Node.js 20.19+ or 22.12+
- npm or bun

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build
```

## Usage

### Adding Books

There are two ways to add EPUB books to your library:

1. **Drag and Drop**: Simply drag an `.epub` file onto the drop zone on the library page
2. **File Picker**: Click the "Add Book" button and select an `.epub` file from your computer

### Library View

The library page displays all your books with:
- Cover images (automatically extracted from EPUB metadata)
- Book title and author
- Last read date (if applicable)

### Managing Books

- **Open a book**: Click on any book card (reader functionality coming soon)
- **Delete a book**: Hover over a book card and click the trash icon

## Implementation Status

### ✅ Completed (Phase 1 & 2)

- [x] Database setup with DexieJS
- [x] EPUB parsing (EPUB3 with EPUB2 fallback support)
  - [x] Metadata extraction (title, author, publisher, etc.)
  - [x] Cover image extraction
  - [x] Manifest parsing
  - [x] Spine parsing
  - [x] Table of contents parsing (NAV and NCX)
- [x] Library page UI
  - [x] Book grid display
  - [x] Drag-and-drop file upload
  - [x] File picker upload
  - [x] Cover image display
  - [x] Book deletion
- [x] Storage service layer
- [x] Toast notifications

### 🚧 Upcoming (Phase 3-6)

- [ ] Reader page
  - [ ] Scroll mode
  - [ ] Paginated mode
  - [ ] Navigation between chapters
  - [ ] Table of contents sidebar
- [ ] Reading settings
  - [ ] Font size adjustment
  - [ ] Line height adjustment
  - [ ] Theme selection (light/dark/sepia)
- [ ] Reading progress tracking
- [ ] Keyboard shortcuts
- [ ] Search functionality
- [ ] Bookmarks and highlights

## Technical Stack

- **Frontend Framework**: React 19 with TypeScript
- **Build Tool**: Vite (Rolldown)
- **Database**: DexieJS (IndexedDB wrapper)
- **UI Components**: Radix UI + shadcn/ui
- **Styling**: Tailwind CSS
- **EPUB Parsing**: fflate (unzip) + native DOM parser
- **Icons**: Lucide React
- **Notifications**: Sonner

## Project Structure

```
src/
├── components/
│   ├── ui/           # Reusable UI components (shadcn/ui)
│   ├── Library.tsx   # Main library page component
│   └── BookCard.tsx  # Individual book card component
├── hooks/
│   └── use-toast.ts  # Toast notification hook
├── lib/
│   ├── db.ts         # DexieDB database schema and operations
│   ├── epub-parser.ts # EPUB file parsing logic
│   ├── book-service.ts # Book management service layer
│   └── utils.ts      # Utility functions
├── App.tsx           # Main app component
└── main.tsx          # App entry point
```

## Database Schema

The application uses IndexedDB with the following stores:

- **books**: Book metadata (title, author, cover, manifest, spine, TOC)
- **bookFiles**: Raw EPUB file contents (by path)
- **readingProgress**: User's reading position for each book
- **readingSettings**: Global reading preferences

## EPUB Support

- ✅ EPUB 3.x (primary support)
- ✅ EPUB 2.x (fallback support)
- ✅ Cover image extraction (multiple methods)
- ✅ Table of contents (NAV and NCX formats)
- ✅ Metadata extraction (Dublin Core)

## Browser Compatibility

This application requires a modern browser with support for:
- ES2022
- IndexedDB
- File API
- Blob URLs

Tested on:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Contributing

This is a demo project following the specifications in `SPEC.md`. Contributions are welcome!

## License

MIT