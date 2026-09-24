# Hunk source provenance

Source: https://github.com/modem-dev/hunk

Revision: `9b95a71b76c472bad21ffa5cc6b01b204e2f6f7a`

License: MIT; the original notice is in [HUNK-LICENSE](HUNK-LICENSE).

## Retained source

`src/shared/hunk/` contains Hunk review semantics from `packages/hunk/src/core/review/`: actions, anchors, document projection, expansion, geometry, identities, intent planning, navigation, note-size limits, reducer, selectors, state, store, types, and validation. `diffPaths.ts` comes from `core/changeset/diffPaths.ts`; `noteSource.ts` extracts one leaf union from `core/run/commandInputs.ts`.

Local adaptations change module paths and replace the upstream changeset input type with a browser-safe structural input type in `model.ts`. The original reducer and intent behavior remain intact. Terminal components, extension runtime, daemon process management, highlighting, and Git execution are not imported by this subtree.

`tests/review/` retains corresponding upstream behavior tests and its `test/helpers/review-store-helpers.ts` fixture, with `bun:test` replaced by Vitest and import paths updated. Application adapter and transport tests are local additions.

`src/shared/review.ts` and `src/web/data/` are local integration code unless a file carries an upstream source notice.
