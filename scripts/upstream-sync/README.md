# Reviewed upstream sync

`.github/workflows/upstream-sync.yml` is the only publisher for upstream updates. It runs weekly
or by `workflow_dispatch`, resolves and fetches `steel-dev/steel-browser`'s advertised default
branch, and moves the protected fork `main` mirror only by a normal fast-forward push. The
read-only candidate job is separated from the narrow publisher job: candidate installs, tests,
and builds run with `contents: read` and `persist-credentials: false`, while only the publisher
receives contents/PR write permission.

A candidate is built from the protected `managed` tip, merged with the exact source commit, and
published as `upstream-sync/<40-character-source-sha>`. The publisher imports a bundle produced by
the candidate job and runs `verify-candidate-commit.mjs`, which independently verifies the exact
managed/source merge parents, generated tree, regular-file modes, classification digest, and an
exact allowlist. A stale primary candidate ref is never overwritten: it recovers on
`upstream-sync/<source-sha>-<managed-sha>` and that ref is verified by the same production checker.

The candidate is never auto-merged, rebased, force-pushed, released, or deployed. The workflow
fails before PR creation on merge conflicts, upstream edits to fork-owned paths, missing runtime
observation, pinned corpus/source drift, managed/root test or build failures, or
dependency/license/browser/migration classification requiring human review. The managed pull
request gate repeats the checks on the actual PR merge ref before the publisher returns success.

Run the local contract and license checks from the repository root:

```sh
node scripts/upstream-sync/verify-workflow.mjs
node --test scripts/upstream-sync/*.test.mjs
node scripts/upstream-sync/verify-license.mjs
```

`capture-observation.mjs` is the only supported way to create an observation directory. It executes
an explicit runtime command and requires these regular files: `manifest.json`,
`observed-receipt.json`, `rest.ndjson`, `route-matrix.json`, `session-id-verdict.json`,
`websocket.ndjson`, `runtime-identity.json`, and `observation-provenance.json`. The runtime identity
pins the upstream SHA, runtime/browser versions, and worker image digest. Provenance records every
artifact hash and the exact commit; unknown files, symlinks, missing files, and hash drift fail
closed. `prepare-corpus.mjs` validates those bytes before copying them and records the receipt
digest in `managed/shared/src/upstream-observed-receipt.ts`. A `FINAL` lock additionally requires
`license-manifest.json` and `scope-manifest.json`, and computes lock fields from those artifact
bytes (there is no caller-supplied digest sidecar). A missing observation produces a blocked run
instead of a false-green PR.

Example capture invocation (the runtime must write the files listed above using the supplied
environment variables):

```sh
node scripts/upstream-sync/capture-observation.mjs \
  --repository-root . \
  --upstream-sha <40-character-sha> \
  --output-directory managed/tests/upstream-observations/<40-character-sha> \
  --runtime-executable node \
  --runtime-arg scripts/your-reviewed-runtime-capture.mjs
```

`classify-upstream.mjs` writes a machine-readable API/browser/dependency/license/migration/scope
classification with the exact source diff digest and merge SHA. The observation directory is
expected to be produced by a separate, human-reviewed runtime capture; this sync workflow does not
invent runtime receipts.
