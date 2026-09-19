# Shared sync package

The application uses `zsh-eng-local-sync-0.2.1.tgz`, built from
`/Users/admin/epub-reader-demo/packages/local-sync` at Reader commit `15b11ee`.
Its 14 build artifacts were checked byte-for-byte against that source build.
The archive makes the app independent of a sibling checkout at build/runtime.
The README in the archive predates the later client-performance note in Reader.

Version 0.2.1 adds optional streaming pull with bounded pages, ordered writes and
cursor checkpoints after commit. Adaptive batching, compiled domain decoding,
empty-outbox shortcuts and index removal remain benchmark experiments.

To update, build and pack the source package, replace the referenced archive and
update both lockfiles. Keep client/server protocol versions compatible. The old
0.1.0 archive is retained for the forthcoming cleanup review; Git history also
preserves it.
