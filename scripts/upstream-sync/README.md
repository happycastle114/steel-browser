# Reviewed upstream sync

`.github/workflows/upstream-sync.yml` is the only publisher for upstream updates. It runs weekly
or by `workflow_dispatch`, resolves and fetches `steel-dev/steel-browser`'s advertised default
branch, and moves the fork's `upstream-main` ref only by a normal fast-forward push. A candidate is then built from
the protected `managed` tip, merged with the exact source commit, and published as
`upstream-sync/<40-character-source-sha>`.

The candidate is never auto-merged, rebased, force-pushed, released, or deployed. The workflow
fails before PR creation on merge conflicts, pinned corpus/source drift, managed/root test or
build failures, or license policy drift. A rerun for the same source SHA reuses the immutable
candidate branch and updates the existing PR body instead of creating a second PR.

Run the local contract and license checks from the repository root:

```sh
node scripts/upstream-sync/verify-workflow.mjs
node --test scripts/upstream-sync/*.test.mjs
node scripts/upstream-sync/verify-license.mjs
```

`prepare-corpus.mjs` is intentionally narrow: it copies the already observed corpus into a new
upstream-SHA directory, rewrites typed `upstreamSha` fields and dependent digests, and appends the
new source-pinned observed-receipt hash to `managed/shared/src/upstream-observed-receipt.ts`.
The workflow invokes it only after the old corpus has verified against the merged source, so
route/source drift remains a human-reviewed corpus update rather than silently becoming a false
green.
