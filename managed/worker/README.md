# Managed worker supervisor and image

The production entrypoint is a narrow private supervisor. It starts the pinned
upstream Steel API unchanged on `127.0.0.1:3001`, waits for upstream health, and
only then listens on private port `3000`. HTTP bodies, response status, additive
headers, and WebSocket bytes pass through without response-body rewriting.
Manager-only identity headers are generated at boot; inbound forged internal
headers and upstream internal-header echoes are removed.

The private manager surfaces are:

- `GET /v1/managed-worker/meta`: stable configured `workerId`, random boot
  `instanceId`, exact upstream revision, runtime browser version, and journal
  version;
- `GET /v1/managed-worker/creates?scope=active`: the bounded zero-or-one active
  create record after a fail-closed loopback session observation;
- `GET /v1/managed-worker/creates/:token`: bounded lookup with `202` and
  `Retry-After` for pending/uncertain records and `200` for replayable records.

`POST /v1/sessions` becomes journal-aware only when the private manager sends
all five valid `X-Managed-*` correlation headers. The supervisor writes
`ACCEPTED` to `/run/steel/create-journal.json` through temp-file, file fsync,
rename, and directory fsync before forwarding. It then records
`UPSTREAM_PENDING`, continues after a manager disconnect, and terminalizes as
`LIVE`, `FAILED_TERMINAL`, or fail-closed `UNCERTAIN`. Replay records retain the
complete JSON value and additive fields while replacing only the four committed
create URL pointers with typed public-URL placeholders. Unsafe/private URLs,
credentials, non-JSON, timeout, and responses beyond 32768 bytes never become a
claimed replay. A live record becomes `RELEASED_TERMINAL` only after the worker
itself observes the upstream slot idle.

The boot-local journal holds at most 1000 records for 600000 ms. Capacity
reclaims expired and then oldest terminal records only; accepted, pending, live,
and uncertain records are never evicted. Worker restart generates a new instance
ID and clears the tmpfs journal together with the browser.

The supervisor exposes exactly these three private control routes. Idle
reconciliation is internal to create enumeration; no separate active-session
control route or historical private compatibility seam is exposed. Raw lookup
tokens and token-bearing path values are never written to logs or telemetry.

`MANAGED_WORKER_ID` accepts only `worker-00` or `worker-01`. Worker configuration
rejects manager create-token secret inputs. The child process receives a closed
allowlist of upstream configuration plus fixed loopback/bind/profile values.
`SIGTERM` first closes the private listener, terminates and reaps upstream, and
escalates to `SIGKILL` only after the fixed grace period. Unexpected upstream
exit closes the supervisor and returns a failing process status.

## Immutable image

[`image/Dockerfile`](image/Dockerfile) consumes exact digest-pinned Node and
official Steel images. The final `scratch` metadata stage intentionally resets
the upstream image's inherited `EXPOSE 9223`; only `3000` remains. The runtime is
numeric UID/GID `10001:10001`, has no Docker socket or privileged/host-network
dependency, and is designed for `read_only: true` with exactly these writable
tmpfs mounts:

| Path | Limit |
| --- | ---: |
| `/run/steel` | 64 MiB |
| `/tmp` | 256 MiB |
| `/var/lib/steel/profile` | 256 MiB |

`/dev/shm` is a separate exact 512 MiB Compose `shm_size` contract. Each worker
has a 2560 MiB limit and 1280 MiB reservation. The writable maxima total
1088 MiB; promotion also requires observed steady memory at or below 640 MiB,
keeping the aggregate below 80% of the limit. `/files`, the upstream
persist profile, and the package cache are immutable symlinks into the declared
tmpfs paths. The image embeds the Apache license, modification notice, source
manifest, upstream revision, base digest, and caller-supplied 40-character
managed source revision as OCI labels. The upstream Dockerfile installs Debian
Chromium from a floating package source, so the repository deliberately does
not claim a browser version from image metadata. The image records
`RUNTIME_READBACK_REQUIRED`; release evidence must run
`/usr/bin/chromium --version` inside the exact digest container on Coolify before
that runtime is promoted. Promotion is fail-closed: the typed receipt must name
the exact candidate `repo@sha256`, include that same value from the running
container's `RepoDigests`, and contain the structured Chromium version found in
the command output.

The final image intentionally requires the verified production-audit build
context, so use the checked-in publisher instead of invoking the final
Dockerfile target directly. Promotion requires it to produce the same OCI
subject and config digest twice for one platform. Each isolated `git archive`
build is pushed only under a unique source-attempt tag with BuildKit provenance
and SBOM attestations. Registry readback verifies the index, platform manifest,
config, source labels, and attestation descriptors before the typed strategy
receipt names the published image by digest. Promotion never relies on an
attempt tag:

```sh
MANAGED_SOURCE_REVISION="$(git rev-parse HEAD)" \
MANAGED_CANDIDATE_REPOSITORY='registry.example/steel-managed-worker' \
MANAGED_BUILD_RUN_ID='ci-run-1234' \
MANAGED_RUNTIME_STRATEGY_RECEIPT='/tmp/runtime-strategy.json' \
MANAGED_PRODUCTION_AUDIT_RECEIPT='/tmp/production-dependency-audit.json' \
managed/worker/image/build-reproducible.sh

MANAGED_SOURCE_REVISION="$(git rev-parse HEAD)" \
MANAGED_WORKER_CANDIDATE_IMAGE="$(jq -r '.candidateImage' /tmp/runtime-strategy.json)" \
MANAGED_WORKER_IMAGE_PLATFORM="$(jq -r '.platform' /tmp/runtime-strategy.json)" \
MANAGED_UPSTREAM_COMBINED_BASE_IMAGE="$(jq -r '.baseImage' /tmp/runtime-strategy.json)" \
MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256="$(sha256sum /tmp/production-dependency-audit.json | cut -d ' ' -f 1)" \
MANAGED_RUNTIME_STRATEGY_RECEIPT='/tmp/runtime-strategy.json' \
MANAGED_RUNTIME_STRATEGY_RECEIPT_SHA256="$(sha256sum /tmp/runtime-strategy.json | cut -d ' ' -f 1)" \
npm run verify:runtime-strategy -w @happycastle/steel-managed-worker
```

The pinned upstream combined runtime remains conditional until that receipt and
the exact Coolify candidate smoke pass. A mismatch or runtime failure blocks it
and requires evaluation of the separately pinned `PLAYWRIGHT_BASE` strategy;
the gate never silently selects a base.

On a macOS checkout without a container runtime, the deterministic static image
gate and all runtime gates remain executable:

```sh
npm run test:image-policy -w @happycastle/steel-managed-worker
npm run typecheck -w @happycastle/steel-managed-worker
npm test -w @happycastle/steel-managed-worker
```

After building and pushing a candidate, capture a readback receipt from the
temporary Coolify container and run the mandatory promotion gate:

```sh
MANAGED_WORKER_CANDIDATE_IMAGE='registry.example/steel-managed-worker@sha256:<digest>' \
MANAGED_WORKER_BROWSER_READBACK_RECEIPT='/path/to/coolify-browser-readback.json' \
MANAGED_WORKER_BROWSER_READBACK_RECEIPT_SHA256="$(sha256sum /path/to/coolify-browser-readback.json | cut -d ' ' -f 1)" \
MANAGED_SOURCE_REVISION="$(git rev-parse HEAD)" \
npm run verify:browser-readback -w @happycastle/steel-managed-worker
```

The single canonical readback receipt rejects absent evidence, mutable image
tags, candidate/`RepoDigests` mismatch, output/version mismatch, root or
privileged execution, writable root, capabilities, sandbox bypass, public CDP,
resource drift, and any create -> CDP `Browser.getVersion` -> release -> idle
lifecycle whose image, source, worker, instance, session, or timestamps do not
match.

Release automation remains responsible for publishing the built subject by
digest and attaching SBOM, provenance, signature, and vulnerability receipts.
No mutable tag is a deployment input.

Static validation is intentionally not runtime proof. The combined runtime is
not production-complete until Coolify supplies the two-build subject receipt,
exact image/source readback, real DBus/CDP/sandbox lifecycle receipt, SBOM,
provenance, signature, scan, and final exactly-three-route integration result.
