# File sidebar toggle performance

Measured against the same local Bun checkout: 21,768 entries, production Vite build, Chromium at 1440×1000. Baseline: commit `53c49d1`. The after runs use the sidebar changes in this report.

| Measurement                                  |    Before |     After | After, repeat |
| -------------------------------------------- | --------: | --------: | ------------: |
| Median reopen                                |  51.35 ms |  15.05 ms |      14.80 ms |
| Slowest of eight reopens                     |  58.80 ms |  17.60 ms |      17.80 ms |
| File-list requests started across nine opens |         9 |         1 |             1 |
| Reopens that reused the mounted tree         |       0/8 |       8/8 |           8/8 |
| Mounted rows                                 |        45 |        45 |            45 |
| First open                                   | 565.10 ms | 671.60 ms |     748.40 ms |
| Initial file-list HTTP duration              | 424.77 ms | 541.48 ms |     619.34 ms |
| Browser errors                               |         0 |         0 |             0 |

Reopening is about 3.4 times faster, or 71% less time. Initial opening is not improved: it still needs the file list and initial model. The higher first-open times in the after runs track higher file-list HTTP durations; the remaining first-open time is about 129–140 ms in these runs. The host file-list path was not changed.

The harness dispatches the sidebar shortcut, then waits for two animation frames with visible mounted rows. It measures application response plus frame scheduling, not physical key-to-display latency. Each run has one first open and eight reopens. The after runs were measured without browser tests running alongside them. No CPU profiler was active. In the baseline, reopening starts another request; many are cancelled when the sidebar closes after 300 ms. The request count includes these cancelled requests.

Raw samples: [tree-toggle.json](tree-toggle.json).

## Changes

- Mount the sidebar on its first use, then hide it with `display: none`. This keeps the tree model, folder expansion, and scroll position. Hidden controls are removed from layout and keyboard navigation.
- Keep one successful file-list snapshot. Source, worktree revision, ignored-file setting, and explicit refresh invalidate it. Failed requests can retry on reopen. Stale responses remain cancelled.
- Prepare Pierre input once per manifest, and skip resetting the model when that input is unchanged. Changing the source or ignored-file setting creates a separate tree model.
- Prebundle the Pierre root import in Vite and Vitest to avoid a dependency reload during browser tests.

The retained state is bounded to the current tree and list; this does not accumulate a model for every visited worktree. Overscan and expansion defaults remain unchanged.

## Validation and review order

50 browser tests passed across the file navigation, app, and navigation integration suites. Coverage includes retained folder state, scroll position after hiding, source switching, explicit refresh, ignored files, invalidation while hidden, and stale-response cancellation. Typecheck, lint, formatting, and production build passed.

1. `src/web/data/browse.ts`: snapshot reuse and invalidation.
2. `src/web/components/RepositoryFiles.tsx`: prepared input and model resets.
3. `src/web/App.tsx`: lazy mount, hidden state, and source identity.
4. `tests/browser/files-navigation.test.tsx` and `tests/browser/app.test.tsx`: behavior checks.
5. `scripts/benchmark-tree-toggle.mjs`: repeatable timing and request counts.

Reproduce with:

```sh
npm run build
node scripts/benchmark-tree-toggle.mjs .benchmarks/bun /tmp/tree-toggle.json
```
