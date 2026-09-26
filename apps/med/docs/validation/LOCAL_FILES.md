# Standalone files and full-file change markers

Validated with the built CLI host and Chromium on 26 September 2026.
Run `node scripts/validate-local-files.mjs` from `apps/med` after `bun run build`.
The script uses disposable repositories and files, then closes its host/browser.

The check exercises absolute file links (including spaces, `#`, and brackets),
line/column positioning, authenticated exact-file access, rejected unopened
writes, conflict detection, Vim saving outside Git, and read-only drops.
Returning from a drop restores the existing review view. Dropped files never
reach a save endpoint. A host integration check starts without a Git repository
and saves an explicitly opened file.

The viewer and editor toolbars both measure 32 px. The first code row keeps the
same vertical position when entering Edit. Editor font and top padding match
the viewer. The full-file gutter shows three added rows and one deletion gap in
the saved comparison fixture. Working-file markers follow HEAD, and mismatched
file identities return 409. Before-side deletion markers are checked as well.

Build, typecheck, lint, 81 affected browser tests, and 14 file-host integration
tests passed. The large Bun HTTP/2 production editor check also passed, including
65 ms eased cursor motion, saves, undo, retained drafts, conflicts, and discard.
These checks establish behavior, not a new performance claim.

[Recorded results](local-files-results.json)

- [Standalone editor, dark](standalone-editor-dark.png)
- [Dropped preview, dark](dropped-file-dark.png)
- [Saved comparison gutter, light](comparison-gutter-light.png)
- [Working-change gutter, dark](working-gutter-dark.png)

Working-file markers now use blue (lighter on dark themes, darker on light
themes) and a 4 px bar. [Light-theme working markers](working-gutter-light.png).
