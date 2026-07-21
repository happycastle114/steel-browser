# Reviewed upstream sync

`.github/workflows/upstream-sync.yml` is the only publisher for upstream updates. It runs weekly
or by `workflow_dispatch`, resolves and fetches `steel-dev/steel-browser`'s advertised default
branch, and moves the protected fork `main` mirror only by a normal fast-forward push. The
read-only candidate job is separated from the narrow publisher job: candidate installs, tests,
and builds run with `contents: read` and `persist-credentials: false`, while only the publisher
receives contents/PR write permission.

A candidate is built from the protected `managed` tip, merged with the exact source commit, and
published as `upstream-sync/<40-character-source-sha>-<40-character-managed-sha>`. The publisher imports a bundle produced by
the candidate job and runs `verify-candidate-commit.mjs`, which independently verifies the exact
managed/source merge parents, generated tree, regular-file modes, classification digest, and an
exact allowlist. A stale primary candidate ref is never overwritten: it recovers on a
candidate-commit-qualified ref and that ref is verified by the same production checker.

The candidate is never auto-merged, rebased, force-pushed, released, or deployed. The workflow
fails before PR creation on merge conflicts, upstream edits to fork-owned paths, missing reviewed
Steel runtime capture, pinned corpus/source drift, managed/root test or build failures, or
dependency/license/browser/migration classification requiring human review. The managed pull
request gate repeats the checks on the actual PR merge ref before the publisher returns success.

Run the local contract and license checks from the repository root:

```sh
node scripts/upstream-sync/verify-workflow.mjs
node --test scripts/upstream-sync/*.test.mjs
node scripts/upstream-sync/verify-license.mjs
```

`capture-observation.mjs` is the only supported way to create an observation directory. The candidate
checks out the exact upstream source before invoking a hash-bound, repository-owned observation runner
and requires these regular files: `manifest.json`,
`observed-receipt.json`, `rest.ndjson`, `route-matrix.json`, `session-id-verdict.json`,
`websocket.ndjson`, `runtime-identity.json`, and `observation-provenance.json`. The runtime identity
pins the upstream SHA, runtime/browser versions, and worker image digest. Provenance records every
artifact hash and the actual checked-out Git HEAD separately from the requested upstream commit;
unknown files, symlinks, missing files, false Git heads, and hash drift fail closed. The publisher
re-runs the same strict schema validator against bytes extracted from the candidate commit.
`prepare-corpus.mjs` validates those bytes before copying them and records the receipt
digest in `managed/shared/src/upstream-observed-receipt.ts`. A `FINAL` lock additionally requires
`license-manifest.json` and `scope-manifest.json`, and computes lock fields from those artifact
bytes (there is no caller-supplied digest sidecar). A missing observation produces a blocked run
instead of a false-green PR.

Capture invocation (the workflow supplies no caller-selected executable or runtime JSON):

```sh
node scripts/upstream-sync/capture-observation.mjs \
  --repository-root . \
  --upstream-sha <40-character-sha> \
  --output-directory "$RUNNER_TEMP/steel-upstream-sync/captured/<40-character-sha>"
```

`classify-upstream.mjs` writes a machine-readable API/browser/dependency/license/migration/scope
classification with the exact source diff digest and merge SHA. Dependency, browser, license, and
migration changes remain blocked until a canonical
`managed/tests/upstream-acknowledgements/<source-sha>.json` binds a stable source/diff review
subject, an `evidencePath` whose bytes are re-hashed during validation, categories, reviewer,
timestamp, and decision. It never binds the managed tip that contains the acknowledgement itself.
The sync workflow never invents runtime receipts or review approvals. Before publication it lists
live GitHub rulesets, fetches each detail endpoint, and fails closed unless the managed branch
requires the managed gate check and `upstream-sync/**` refs are deletion, non-fast-forward, and
update protected.
