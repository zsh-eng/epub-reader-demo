# Workbench architecture

Workbench keeps independent apps under `apps/` and reusable code under
`packages/`. App folders own their UI, domain data, tests, deployment settings,
and local development files. Shared packages must not import app code.

## Current boundaries

- **Reader** owns the web EPUB app and its deployed Hono Worker. Read
  [Reader architecture](../apps/reader/docs/ARCHITECTURE.md) before changing
  its data loading, storage, caches, or Reader lifecycle.
- **Arctic** owns the native iOS and Mac apps, share extension, Swift sync package,
  and WebView extraction bundle. Read its [app guide](../apps/arctic/README.md),
  [performance evidence](../apps/arctic/PERFORMANCE.md), and
  [sync boundaries](../packages/arctic-sync-server/README.md) before changes.
- **local-sync** owns the generic record protocol and engine. Its
  [adapter contracts](../packages/local-sync/README.md) apply to consumers.
- **text-highlighter** owns DOM selection and highlight restoration.
- **arctic-sync-server** exposes private auth and sync route factories. The
  Reader Worker supplies authentication and database/object-storage bindings.
  It is a package, not a separate deployed service.

## Dependency and storage rules

Use Bun workspaces and the root `bun.lock`. Put dependencies in the manifest
of the app or package that imports them. Root scripts provide common entry
points; commands execute in the owning app directory.

Keep metadata separate from large files. Local writes must not wait for the
network. Do not put API keys in synchronized records. Preserve the existing
storage and migration boundaries during structural changes. Arctic's live
ArticleStore migration requires separate explicit approval; moving files does
not activate it.

See [Local-first data and sync](../LOCAL_FIRST.md) and
[UI performance](../UI_PERFORMANCE.md) for reusable patterns and validation.
