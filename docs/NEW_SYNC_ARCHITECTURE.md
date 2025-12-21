I've analyzed the current sync architecture. You're right to be concerned - the current implementation has become complex with multiple interleaving concerns. Let me share my analysis and propose a cleaner approach.

## Current Complexity Analysis

Your sync system currently has:

1. **Multiple sources of truth** - Book state is split across `Book` (with `isDownloaded`, `remoteEpubUrl`), `BookSyncState` (5 different statuses), and `SyncCursor`

2. **Mixed concerns in SyncService** - Metadata sync, file sync coordination, query invalidation, and state machine management are all interleaved

3. **Inconsistent patterns** - Progress already uses a replicated log pattern (with `clientSeq`/`serverSeq`), but books use a stateful approach

4. **Complex state machine** - `BookSyncState` has transitions like: `pending_upload → uploading → synced` and `pending_download → synced` and `error` states with retry counts

## Replicated Log Approach - Analysis

A single replicated event log would look like:

```epub-reader-demo/src/lib/sync-service.ts#L1-20
interface SyncEvent {
  id: string;
  type: 'book_added' | 'book_metadata_updated' | 'book_deleted' | 
        'progress_updated' | 'highlight_added' | 'highlight_deleted';
  entityId: string;  // fileHash for books, id for progress
  payload: unknown;
  clientSeq: number;
  serverSeq?: number;
  clientTimestamp: Date;
  serverTimestamp?: Date;
}
```

**Pros:**
- Single source of truth for ordering
- Easy conflict resolution (last-writer-wins on `serverSeq`)
- Easier to debug/replay
- Testable in isolation

**Cons:**
- Files (EPUB blobs) don't fit well in an event log
- Need to "materialize" current state from events
- May be overkill for books (they change rarely)

## My Recommendation: Layered Abstraction

Rather than a single replicated log, I'd suggest **separating concerns with better abstractions**:

```/dev/null/architecture.md#L1-30
┌─────────────────────────────────────────────────────────────┐
│                      SyncOrchestrator                       │
│  (coordinates sync timing, online/offline, periodic sync)   │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  BookMetaSync   │  │  ProgressSync   │  │  HighlightSync  │
│                 │  │  (append-only   │  │  (append-only   │
│  (cursor-based, │  │   log pattern)  │  │   log pattern)  │
│  rare changes)  │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    FileTransferService                      │
│  (uploads/downloads, completely separate from metadata)     │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Principles:

1. **Each sync adapter is a pure function** - given local state + server response, return operations to perform
2. **File transfers are decoupled** - metadata sync just records "this book needs files uploaded/downloaded"
3. **State machines become explicit** - instead of implicit status fields, model as a state machine
4. **Each layer is independently testable**

Would you like me to sketch out what this refactored architecture would look like in code? I could create:

1. A generic `SyncAdapter<T>` interface that all sync types implement
2. A `SyncEngine` that handles the cursor-based pull/push protocol generically
3. Separate the book sync state into clearer "local only" / "remote only" / "synced" states
4. Extract file transfer concerns completely

This would make it much easier to:
- Write unit tests for each adapter in isolation
- Add new sync types (e.g., highlights)
- Reason about what state a book is in
- Debug sync issues

What's your preference - go with a replicated log for everything, or this layered approach?
