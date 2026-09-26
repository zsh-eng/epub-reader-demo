# Vim working-file editing

The production browser check uses the same 266,040-byte Bun HTTP/2 source as the
highlighting comparison: `src/js/node/http2.ts` at
`26e7a4b3690dce60d4dcd7f47a12b531deb00837`. It creates two disposable repositories,
starts the real CLI host, and opens a direct file link to the second repository.

Verified behavior:

- Twinkleplop syntax colors in the editable file.
- Normal and Visual cursor movement with the viewer's 65 ms ease-out transition.
  The browser check samples actual rendered positions at the start, midpoint,
  and end, and checks that reduced-motion mode disables the transition.
- Vim insert and `:w` save to the real file on disk.
- Undo after saving marks the draft dirty; saving restores byte-identical source.
- Draft contents and cursor remain available after switching tabs.
- A save after an external write fails and retains both the external file and draft.
- Explicit discard exits editing and reads current disk content.

The browser suite also verifies `ciw`, one-step undo/redo across tab switches,
CRLF preservation, saved/unsaved dots, entering Insert at the existing Vim cursor,
and fresh content when reopening a clean editor. Host integration tests cover
large request bodies, executable permissions, concurrent stale saves, path and
repository boundaries, and symlink refusal. The affected suites pass 83 browser
and 19 host tests. Build, typecheck, and lint pass.

The diagnostic typing trace records 40 input-event-to-next-frame callbacks:
median 7.0 ms, maximum 14.4 ms on this run. This is not physical key-to-paint
latency, a broad responsiveness guarantee, or a comparison with another editor.
Tracing was active. Syntax scanning runs in a worker after a 100 ms pause; input
does not wait for new colors. Large-file scrolling and IME behavior still merit
hands-on testing across browsers and devices.

[Raw result](file-editing-results.json) includes all samples and the exact source
hash. Local trace and screenshot artifacts are under `.benchmarks/file-editing`.
Run from `apps/med`:

```sh
bun run build
node scripts/validate-file-editing.mjs
```

The script fetches the pinned source if it is missing, verifies its hash, and
cleans up its temporary host, browser, and repositories. It does not write to the
user's Workbench files or running med host. See [editing usage](../USAGE.md#edit-working-files)
for save, conflict, draft-lifetime, and source restrictions.
