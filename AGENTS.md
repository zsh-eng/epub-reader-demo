# Workbench agent guidelines

Use concise ASD-STE100 technical English for software explanations. After
changes, give a brief summary and a suggested order to review changed files.
Include line numbers when useful. Preserve unrelated edits.

## Workspace layout

- `apps/reader`: web Reader and deployed Cloudflare Worker. Follow its `AGENTS.md`.
- `apps/arctic`: native Arctic iOS app. Follow its `AGENTS.md`.
- `packages`: shared libraries and private server support. Do not import app code.
- Root guides document reusable patterns; keep them easy to read.

Read [Architecture](docs/ARCHITECTURE.md) before changes to data, caching, sync,
or performance. Read the owning app's architecture and tests as well.

## Tools and checks

Use **bun** for JavaScript/TypeScript dependencies and scripts. Install from
this directory; keep one root `bun.lock`. Declare dependencies in their owner.
Use `bun run build` for the web app's type check and build; do not run `npx tsc`.

Choose checks for the affected app. For Reader, follow its test matrix. For
Arctic, use its WebView tests, Swift checks, and Xcode build as applicable.
Test interaction changes in a browser, simulator, or device. Use traces for
performance claims; report checks that remain open. Documentation-only changes
need a diff and link review, not a build.

Keep deployment resource names and production data separate from repository
names. Do not deploy or run remote migrations as a side effect of a refactor.
