# Workbench

A monorepo for personal apps and shared local-first software.

## Apps and packages

| Path | Purpose |
| --- | --- |
| [apps/reader](apps/reader/README.md) | Web EPUB Reader. React, IndexedDB, and a Cloudflare Worker. |
| [apps/arctic](apps/arctic/README.md) | Arctic, the native iOS article reader and share extension. |
| [packages/local-sync](packages/local-sync/README.md) | Shared sync protocol, engine, and Dexie/Hono adapters. |
| [packages/text-highlighter](packages/text-highlighter/README.md) | DOM text selection and highlight restoration. |
| [packages/arctic-sync-server](packages/arctic-sync-server/README.md) | Private Arctic auth and sync routes, hosted by the Reader Worker. |

Arctic works locally. Its native sync storage integration remains dormant;
this repository move does not enable it.

## Start

Use Bun from this directory. There is one workspace lockfile.

```sh
bun install --frozen-lockfile
bun run dev:reader
```

For Arctic, open `apps/arctic/ArticleReader.xcodeproj` in Xcode and select the
**ArticleReader** scheme. See its README for signing and device setup.

| Command, from this directory | Action |
| --- | --- |
| `bun run build` | Build shared libraries and the web Reader. |
| `bun run test:client --run` | Run Reader client tests. |
| `bun run test:server --run` | Run Worker tests with local D1. |
| `bun run test:packages` | Test shared packages. |
| `bun run test:e2e` | Run Reader browser tests. |
| `bun run build:arctic-web` | Bundle Arctic's WebView extraction code. |
| `bun run test:arctic-web` | Test Arctic's WebView code. |
| `bun run lint` | Check TypeScript and JavaScript sources. |
| `bun run deploy` | Build and deploy the existing Reader Worker. |

The default `dev`, `build`, `test`, `deploy`, database, and diagnostic commands
still target Reader. Each app owns its dependencies, tests, and configuration.
Reader environment files belong in `apps/reader/`; start with its
[environment examples](apps/reader/.env.example) and
[Worker secret names](apps/reader/.dev.vars.example).
Deployment names, domains, database bindings, and iOS bundle IDs are unchanged.

## Guides for future projects

- [Local-first data and sync](LOCAL_FIRST.md): durable local writes, files, and preloading.
- [Reading time](READING_TIME.md): session boundaries and idle time.
- [UI performance](UI_PERFORMANCE.md): traces, virtualization, and image preparation.
- [Adapting design references](DESIGN_REFERENCES.md): turn references into testable behavior.
- [Architecture](docs/ARCHITECTURE.md): workspace boundaries and app-specific designs.

Add independent products under `apps/`. Add a package under `packages/` when
code has a clear shared contract. Keep app data and generated output out of Git.
