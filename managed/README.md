# Managed control plane

This directory contains fork-owned code only. The upstream worker remains unchanged while the
managed packages provide isolated control-plane boundaries:

- `shared`: validated contracts and bootstrap policy.
- `gateway`: the future single manager for one disjoint worker pool.
- `console`: the future operations console.
- `worker`: the future private worker identity supervisor.
- `tests`: cross-package and locked-upstream contract fixtures.

`upstream.lock.json` is the single source of the tested upstream commit and remains at its typed
corpus-lock stage. `runtime-scope.json` separately binds that lock, the overlay, corpus, license,
and browser input to the two static worker pools. It certifies source configuration only at
`CONFIG_BOUND` with capacity `UNVERIFIED_UNTIL_TASK_41`; it does not claim live capacity, runtime
digests, application identity, or secret equality for a stopped Coolify project.

Run `npm run verify:runtime-scope` for the fresh-clone source check. The portable secret fixture
validates the expected manager-init contract without reading or emitting a secret value. It creates
no live resources, records cleanup as not applicable, and never consumes caller-authored data as
runtime proof. `--live-observation` fails closed with `LIVE_PROOF_DEFERRED_TO_TASK_41` until the
trusted Linux observer exists.
