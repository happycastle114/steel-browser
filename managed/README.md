# Managed control plane

This directory contains fork-owned code only. The upstream worker remains unchanged while the
managed packages provide isolated control-plane boundaries:

- `shared`: validated contracts and bootstrap policy.
- `gateway`: the future single manager for one disjoint worker pool.
- `console`: the future operations console.
- `worker`: the future private worker identity supervisor.
- `tests`: cross-package and locked-upstream contract fixtures.

`upstream.lock.json` is the single source of the tested upstream commit. The bootstrap stage
intentionally contains no corpus, browser/runtime, license, or scope digests. Later plan tasks
advance the same typed lock instead of creating another source of truth.
