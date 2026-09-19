# Shared sync package

`zsh-eng-local-sync-0.1.0.tgz` is the built package from
`/Users/admin/epub-reader-demo/packages/local-sync`, merged on Reader main at
`59dd80a`. Both Spaced repositories use the same archive. This avoids a runtime
or build dependency on a sibling checkout. Package source is maintained in Reader.

To update, build and pack that package, replace the archive in both repositories,
and update both lockfiles. Do not change one side of the protocol alone.
