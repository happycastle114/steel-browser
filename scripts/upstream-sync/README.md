# Reviewed upstream sync

`.github/workflows/upstream-sync.yml` is the only publisher for upstream updates. It runs weekly
or by `workflow_dispatch`, resolves and fetches `steel-dev/steel-browser`'s advertised default
branch, and moves the protected fork `main` mirror only by a normal fast-forward push. The
read-only candidate job is separated from the narrow publisher job: candidate installs, tests,
and builds run with `contents: read` and `persist-credentials: false`, while only the publisher
receives contents/PR write permission.

A candidate is built from the protected `managed` tip, merged with the exact source commit, and
published as `upstream-sync/<40-character-source-sha>`. The publisher imports a bundle produced by
the candidate job and verifies the exact managed/source merge parents, generated commit tree,
lock/corpus/receipt paths, and current managed base before pushing.

The candidate is never auto-merged, rebased, force-pushed, released, or deployed. The workflow
fails before PR creation on merge conflicts, upstream edits to fork-owned paths, missing runtime
observation, pinned corpus/source drift, managed/root test or build failures, or license/browser/
migration classification requiring human review. A rerun for the same source SHA reuses a branch
only when its tree and merge provenance exactly match the verified bundle; arbitrary descendants
are rejected.

Run the local contract and license checks from the repository root:

```sh
node scripts/upstream-sync/verify-workflow.mjs
node --test scripts/upstream-sync/*.test.mjs
node scripts/upstream-sync/verify-license.mjs
```

`prepare-corpus.mjs` is intentionally fail-closed: it requires an independently captured corpus
directory (the workflow looks for `managed/tests/upstream-observations/<sourceSha>`), validates the
four JSON artifacts already carry that exact SHA, copies their bytes without rewriting observations,
and records the receipt digest in `managed/shared/src/upstream-observed-receipt.ts`. It refuses to
carry forward an old receipt; a `FINAL` lock additionally requires the captured
`final-lock-fields.json` browser/license/scope digests. A missing observation produces a blocked
run instead of a false-green PR.

`classify-upstream.mjs` writes the machine-readable API/browser/license/migration/scope review
classification used in the candidate artifact and PR body. The observation directory is expected
to be produced by a separate, human-reviewed runtime capture; this sync workflow does not invent
runtime receipts.
