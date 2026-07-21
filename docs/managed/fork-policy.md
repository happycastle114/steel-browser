# Managed fork policy

The repository is a native fork of `steel-dev/steel-browser`. Upstream history and fork-owned
derivatives have separate branch responsibilities.

## Branch responsibilities

- `main` is a fast-forward-only mirror of upstream `main`. It accepts no fork-owned derivative
  commit, force push, rebase, or deletion.
- `managed` retains the original protected integration history; it is not the release branch.
- `production` starts from that history and is the canonical release and upstream-sync branch
  for fork-owned work. After the initial bootstrap commit, changes arrive through CI-verified pull
  requests. The repository operator does not use direct push, force push, or deletion on this branch.
- `upstream-sync/<upstreamSha>` branches start from `production`, merge the exact new upstream commit,
  update the single upstream lock and corpus, and open one reviewed pull request. Conflicts are
  resolved by a human-reviewed commit; automation never rebases, force-pushes, auto-merges, releases,
  or deploys an upstream update.

## Workspace boundary

Fork-owned application code lives in `managed/shared`, `managed/gateway`, `managed/console`, and
`managed/worker`. Generated deployment inputs live under `deploy/coolify`. The upstream singleton
session service and CDP internals remain unchanged unless a separately approved architecture gate
proves an incompatibility.

The `k3s-happycastle`, `k3s-terraform`, and `cloud-browser-poc` workspaces and local Steel wrappers,
configuration, and launch agents are not sources for this fork and must never be copied or staged.

## Lock stages

`BOOTSTRAP` permits only repository identity and the reachable upstream commit. Task 3 adds the
protocol corpus and session-ID verdict at `CORPUS_LOCKED`. Task 6 adds the browser/runtime, license,
and scope digests and advances the lock to `FINAL`. Runtime implementation rejects any earlier stage.
