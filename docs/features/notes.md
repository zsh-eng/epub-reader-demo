# Reader notes

## Capture

A notebook contains the book's saved notes and bookmarks. Notes require
non-whitespace text. Bookmark controls, editing, and deletion controls are not
part of the first Reader integration; storage helpers already support them.

The composer has one local draft per book. Text and target are saved together.
Typing starts a page note at the first available text on the visible page.
Selecting text or an existing highlight replaces the draft target and keeps its
text, like attaching a reply to an unfinished message. Removing the quote keeps
the target's location but removes its quote and highlight attachment. Changing
pages does not move an existing draft's target.

New-note and edit drafts are separate. Editing never overwrites a compose draft.
Saving or cancelling an edit removes only that edit draft. A received remote edit
returns a conflict; a received deletion cannot be undone by ordinary submission.

## Storage and sync

`notes` and `highlights` are synced. `noteDrafts` is local-only. Each note owns its
chapter ID, canonical text offsets, and quote snapshot. Page numbers and screen
positions are derived from the current pagination and are not durable data.

A selected-text note creates an invisible highlight on submission. An existing
highlight note keeps the highlight reference. Notes retain their location and
quote after highlight deletion; deleting a note retains its highlight.

Submission inserts the note, inserts any new highlight, and removes the compose
draft in one IndexedDB transaction. The sync middleware writes the outbox in the
same transaction. Network access is not needed to save. A failed local write
keeps the draft. Blank notes and records beyond the sync size limit are rejected.

## Reader integration

`useReaderNotes` owns draft restore, serialized writes, submission, and the book
query. It runs below Reader's pagination owner. Keystrokes do not update the query
cache or rerender Reader. Notebook rendering is reused while only draft text
changes. The same book query serves time order, book order, previews, and margins.

Restore completes before input is enabled. Draft writes use a 150 ms debounce;
Send flushes the latest text and target before submission. Dismissal and component
cleanup request a flush, as does document visibility loss. These browser lifecycle
callbacks are best effort: an abrupt process kill can lose the most recent
uncommitted draft changes. Completed note transactions survive reopening.

The UI clears input only after the local transaction succeeds. During submission,
input is read-only to prevent duplicate sends or discarding newly typed text,
while keeping keyboard focus.

Location conversion uses the same canonical text as highlights. A batched worker
query resolves content anchors to current page numbers using existing pagination.
Unresolved locations are shown explicitly and cannot navigate to a guessed page.
Source-file replacement and fallback text matching require further verification;
this release does not promise relocation across different editions of a book.

## Verification

Test compose/reply/remove-quote, offline send/reopen, unsent-draft recovery, rapid
Send, navigation, resize, font changes, incoming sync, and highlight deletion.
Inspect IndexedDB alongside visible results. A draft write must not produce an
outbox record. A failed selected-text submission must leave neither a partial
highlight nor a partial note. Check real iOS keyboard and lifecycle behavior on a
device; desktop viewport emulation does not prove it.
