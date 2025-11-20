# Implementation Plan

## Database & Persistence

- [ ] **Database Schema & Types**: Define schema for `highlights` and `readingProgress` in `src/lib/db.ts`.
- [ ] **Highlight Persistence**: Connect Reader highlight actions to DB (save/load).
- [ ] **Reading Progress**: Implement auto-save and restore of reading position (chapter + scroll offset).

## Reader Settings (Appearance)

- [ ] **Reader Settings Hook**: Create `useReaderSettings` for preferences (font size, line height, theme, font family).
- [ ] **Reader Settings UI**: Build a Popover component using shadcn UI components to adjust settings.
- [ ] **Apply Settings**: Inject CSS variables into `ReaderContent` to apply the user's choices.

## Future / Sync

- [ ] **Backend Sync**: (Deferred) Plan for syncing data across devices.
