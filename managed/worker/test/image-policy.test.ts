import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  MANAGED_WORKER_IMAGE_POLICY,
  MANAGED_WORKER_RUNTIME,
  parseManagedWorkerImagePolicy,
  parseUpstreamImageLock,
} from "../src/image-policy.js"

const upstreamImageLockPath = fileURLToPath(
  new URL("../image/upstream-image.lock.json", import.meta.url),
)

describe("managed worker immutable image policy", () => {
  it("accepts the canonical pinned non-root read-only runtime contract", () => {
    // Given
    const policy = MANAGED_WORKER_IMAGE_POLICY

    // When
    const parsed = parseManagedWorkerImagePolicy(policy)

    // Then
    expect(parsed).toEqual(policy)
  })

  it("keeps observed memory plus writable maxima within 80 percent", () => {
    const writableBytes =
      MANAGED_WORKER_RUNTIME.SHM_BYTES +
      Object.values(MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS_BYTES).reduce(
        (total, bytes) => total + bytes,
        0,
      )
    const aggregateBytes =
      MANAGED_WORKER_RUNTIME.MAX_MEMORY_CURRENT_BYTES + writableBytes

    expect(
      aggregateBytes * 100,
    ).toBeLessThanOrEqual(
      MANAGED_WORKER_RUNTIME.MEMORY_LIMIT_BYTES *
        MANAGED_WORKER_RUNTIME.PROMOTION_MAX_UTILIZATION_PERCENT,
    )
  })

  it.each([
    ["floating base", { upstreamImage: "ghcr.io/steel-dev/steel-browser:latest" }],
    ["root uid", { uid: 0 }],
    ["public debugger", { exposedPorts: [3000, 9223] }],
    ["wrong upstream bind", { upstreamHost: "0.0.0.0" }],
    ["wrong upstream port", { upstreamPort: 9223 }],
    ["missing runtime tmpfs", { writableTmpfs: ["/tmp", "/var/lib/steel/profile"] }],
    [
      "wrong runtime tmpfs bytes",
      {
        writableTmpfsBytes: {
          ...MANAGED_WORKER_IMAGE_POLICY.writableTmpfsBytes,
          "/run/steel": 1,
        },
      },
    ],
    ["extra writable mount", { writableTmpfs: ["/run/steel", "/tmp", "/var/lib/steel/profile", "/app"] }],
    ["privileged runtime", { privileged: true }],
    ["host network", { hostNetwork: true }],
    ["memory limit drift", { memoryLimitBytes: 2_147_483_648 }],
    ["memory reservation drift", { memoryReservationBytes: 1_073_741_824 }],
    ["shm drift", { shmBytes: 268_435_456 }],
    ["docker socket", { socketMounts: ["/var/run/docker.sock"] }],
    ["mutable root", { readOnlyRootFileSystem: false }],
    ["unverified browser claim", { browserVersion: "999.0.0.0" }],
    ["missing runtime browser proof", { browserVersionProof: "VERIFIED" }],
  ])("rejects the %s mutation", (_name, mutation) => {
    // Given
    const mutated = { ...MANAGED_WORKER_IMAGE_POLICY, ...mutation }

    // When
    const parse = () => parseManagedWorkerImagePolicy(mutated)

    // Then
    expect(parse).toThrow()
  })
})

describe("upstream image registry receipt", () => {
  it("accepts the immutable upstream provenance with browser readback pending", () => {
    // Given
    const input: unknown = JSON.parse(
      readFileSync(upstreamImageLockPath, "utf8"),
    )

    // When
    const lock = parseUpstreamImageLock(input)

    // Then
    expect(lock.indexDigest).toBe(
      "sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d",
    )
    expect(lock.browserVersion).toEqual({
      command: "/usr/bin/chromium --version",
      environment: "Coolify exact digest container",
      status: "RUNTIME_READBACK_REQUIRED",
      value: null,
    })
  })

  it.each([
    ["index digest", { indexDigest: "sha256:unverified" }],
    [
      "browser claim",
      {
        browserVersion: {
          command: "/usr/bin/chromium --version",
          environment: "Coolify exact digest container",
          status: "RUNTIME_READBACK_REQUIRED",
          value: "999.0.0.0",
        },
      },
    ],
  ])("rejects a mutated %s", (_name, mutation) => {
    // Given
    const canonical: unknown = JSON.parse(
      readFileSync(upstreamImageLockPath, "utf8"),
    )
    const mutated = { ...parseUpstreamImageLock(canonical), ...mutation }

    // When
    const parse = () => parseUpstreamImageLock(mutated)

    // Then
    expect(parse).toThrow()
  })
})
