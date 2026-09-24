# med-zoekt

This helper uses the official [Sourcegraph Zoekt](https://github.com/sourcegraph/zoekt) module at `v0.0.0-20260911061844-153817f643cd`. The same module supplies `zoekt-git-index`. `go.mod` and `go.sum` pin both build targets. Go 1.25.9 or newer is required to build them. The compiled tools do not require Go at runtime.

The Node host starts the helper with `--index <directory> --socket <path>`. The socket must be in an existing directory with mode `0700`. The helper uses mode `0600` for the socket. It does not listen on TCP. Keep its standard input open; EOF, SIGINT, or SIGTERM stops the helper and removes its socket.

The separate `--lock <path>` mode takes a non-blocking exclusive kernel file lock and writes `locked` followed by a newline to standard output. It holds the lock until standard input closes or it receives SIGINT/SIGTERM. A competing owner gets a nonzero exit immediately. The lock file is never removed; the kernel releases the lock when its file descriptor closes or the process exits, including a crash.

- `GET /health` returns the loaded index's `{branches: [{name, commit}], version}`.
- `POST /search` accepts `{branch, commit, query}`. The branch must match an indexed branch and the expected commit. A mismatch returns HTTP 409.
- Search text is a literal, case-insensitive content substring. It is never parsed as query syntax. The branch uses an exact structured query.
- Results are `{matches: [{path, line, text}], truncated}`. Limits are 200 lines, 1,000 Unicode characters per snippet, and 1 MiB per response. Line numbers cannot exceed 200,000. Paths must be safe repository-relative paths.
- Each index directory must contain one repository. The helper reads loaded shard metadata before and after each search. It does not trust a sidecar manifest for branch versions.
- The helper does not run Git, ctags, repository code, or build hooks. The parent runs the indexer separately with its own limits.

Run helper tests with `go test ./...`. The helper is part of med-diff and uses the project's license. Zoekt's source and module dependencies retain their own licenses.
