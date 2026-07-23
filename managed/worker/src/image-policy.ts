import { z } from "zod"

const HEALTH_START_PERIOD_SECONDS = 90 as const

export const MANAGED_WORKER_IMAGE_INPUT = {
  BROWSER_VERSION_PROOF: "RUNTIME_READBACK_REQUIRED",
  BUILDER_IMAGE:
    "docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37",
  UPSTREAM_IMAGE:
    "ghcr.io/steel-dev/steel-browser@sha256:b0a3253a96a11e861ccfbb61ccb6679b801b94070ddf5463c29f4df97395d85d",
  UPSTREAM_REVISION: "5880b48c1af107219ff3d904edbb8f6b76bea9b6",
} as const

export const MANAGED_WORKER_RUNTIME = {
  COLD_START_TIMEOUT_MS: HEALTH_START_PERIOD_SECONDS * 1_000,
  GID: 10001,
  HEALTH_INTERVAL_SECONDS: 10,
  HEALTH_PATH: "/v1/managed-worker/meta",
  HEALTH_PROBE_TIMEOUT_SECONDS: 3,
  HEALTH_RETRIES: 3,
  HEALTH_START_PERIOD_SECONDS,
  MAX_MEMORY_CURRENT_BYTES: 671_088_640,
  MEMORY_LIMIT_BYTES: 2_684_354_560,
  MEMORY_RESERVATION_BYTES: 1_342_177_280,
  PORT: 3000,
  PROMOTION_MAX_UTILIZATION_PERCENT: 80,
  SHM_BYTES: 536_870_912,
  UID: 10001,
  UPSTREAM_HOST: "127.0.0.1",
  UPSTREAM_PORT: 3001,
  WRITABLE_TMPFS_BYTES: {
    "/run/steel": 67_108_864,
    "/tmp": 268_435_456,
    "/var/lib/steel/profile": 268_435_456,
  },
  WRITABLE_TMPFS: ["/run/steel", "/tmp", "/var/lib/steel/profile"],
} as const

const UpstreamImageLockSchema = z
  .object({
    browserVersion: z
      .object({
        command: z.literal("/usr/bin/chromium --version"),
        environment: z.literal("Coolify exact digest container"),
        status: z.literal(MANAGED_WORKER_IMAGE_INPUT.BROWSER_VERSION_PROOF),
        value: z.null(),
      })
      .strict()
      .readonly(),
    createdDate: z.literal("2026-07-20"),
    indexDigest: z.literal(
      "sha256:b0a3253a96a11e861ccfbb61ccb6679b801b94070ddf5463c29f4df97395d85d",
    ),
    packageVersion: z.literal("1049559672"),
    platforms: z
      .object({
        "linux/amd64": z
          .object({
            attestationDigest: z.literal(
              "sha256:8587d4e2cba62e329c5f16f24d4712fb91f4e9f98d2099c0f8cef9942df8e699",
            ),
            configDigest: z.literal(
              "sha256:54538299b643d23519917be6b04b1595f33589ef08bcdc01d0fa55aba33fdb13",
            ),
            subjectDigest: z.literal(
              "sha256:6c68ae1e2edb89f0a5f1a916cf7f2374e7f0972d565bb3d216b4eb6fc2276c1e",
            ),
          })
          .strict()
          .readonly(),
        "linux/arm64": z
          .object({
            attestationDigest: z.literal(
              "sha256:15b47f745a8cc634d2f36381434b2b44fa77e15581571ca079ea8541628e014c",
            ),
            configDigest: z.literal(
              "sha256:6ecbabba845d289a21d9c50ea77c6bb5d3e5eb99f973cd2cdca1e04072795236",
            ),
            subjectDigest: z.literal(
              "sha256:f7d72884fb1ba2e534e983679db53d9f720e67d7cf2d2e24d35084a43228e554",
            ),
          })
          .strict()
          .readonly(),
      })
      .strict()
      .readonly(),
    provenance: z
      .object({
        githubActionsRunId: z.literal("29774838732"),
        ref: z.literal("refs/heads/main"),
        repository: z.literal("https://github.com/steel-dev/steel-browser"),
        revision: z.literal(MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_REVISION),
      })
      .strict()
      .readonly(),
    registry: z.literal("ghcr.io"),
    repository: z.literal("steel-dev/steel-browser"),
    schemaVersion: z.literal(1),
  })
  .strict()
  .readonly()

const ManagedWorkerImagePolicySchema = z
  .object({
    browserVersion: z.null(),
    browserVersionProof: z.literal(
      MANAGED_WORKER_IMAGE_INPUT.BROWSER_VERSION_PROOF,
    ),
    builderImage: z.literal(MANAGED_WORKER_IMAGE_INPUT.BUILDER_IMAGE),
    capabilities: z.array(z.never()).length(0).readonly(),
    exposedPorts: z.tuple([z.literal(MANAGED_WORKER_RUNTIME.PORT)]).readonly(),
    gid: z.literal(MANAGED_WORKER_RUNTIME.GID),
    healthPath: z.literal(MANAGED_WORKER_RUNTIME.HEALTH_PATH),
    hostNetwork: z.literal(false),
    memoryLimitBytes: z.literal(MANAGED_WORKER_RUNTIME.MEMORY_LIMIT_BYTES),
    memoryReservationBytes: z.literal(
      MANAGED_WORKER_RUNTIME.MEMORY_RESERVATION_BYTES,
    ),
    privileged: z.literal(false),
    readOnlyRootFileSystem: z.literal(true),
    socketMounts: z.array(z.never()).length(0).readonly(),
    shmBytes: z.literal(MANAGED_WORKER_RUNTIME.SHM_BYTES),
    uid: z.literal(MANAGED_WORKER_RUNTIME.UID),
    upstreamHost: z.literal(MANAGED_WORKER_RUNTIME.UPSTREAM_HOST),
    upstreamImage: z.literal(MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_IMAGE),
    upstreamPort: z.literal(MANAGED_WORKER_RUNTIME.UPSTREAM_PORT),
    upstreamRevision: z.literal(MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_REVISION),
    writableTmpfs: z
      .tuple([
        z.literal(MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS[0]),
        z.literal(MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS[1]),
        z.literal(MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS[2]),
      ])
      .readonly(),
    writableTmpfsBytes: z
      .object({
        "/run/steel": z.literal(
          MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS_BYTES["/run/steel"],
        ),
        "/tmp": z.literal(MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS_BYTES["/tmp"]),
        "/var/lib/steel/profile": z.literal(
          MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS_BYTES[
            "/var/lib/steel/profile"
          ],
        ),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly()

export type ManagedWorkerImagePolicy = z.infer<
  typeof ManagedWorkerImagePolicySchema
>
export type UpstreamImageLock = z.infer<typeof UpstreamImageLockSchema>

export const MANAGED_WORKER_IMAGE_POLICY = {
  browserVersion: null,
  browserVersionProof: MANAGED_WORKER_IMAGE_INPUT.BROWSER_VERSION_PROOF,
  builderImage: MANAGED_WORKER_IMAGE_INPUT.BUILDER_IMAGE,
  capabilities: [],
  exposedPorts: [MANAGED_WORKER_RUNTIME.PORT],
  gid: MANAGED_WORKER_RUNTIME.GID,
  healthPath: MANAGED_WORKER_RUNTIME.HEALTH_PATH,
  hostNetwork: false,
  memoryLimitBytes: MANAGED_WORKER_RUNTIME.MEMORY_LIMIT_BYTES,
  memoryReservationBytes: MANAGED_WORKER_RUNTIME.MEMORY_RESERVATION_BYTES,
  privileged: false,
  readOnlyRootFileSystem: true,
  socketMounts: [],
  shmBytes: MANAGED_WORKER_RUNTIME.SHM_BYTES,
  uid: MANAGED_WORKER_RUNTIME.UID,
  upstreamHost: MANAGED_WORKER_RUNTIME.UPSTREAM_HOST,
  upstreamImage: MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_IMAGE,
  upstreamPort: MANAGED_WORKER_RUNTIME.UPSTREAM_PORT,
  upstreamRevision: MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_REVISION,
  writableTmpfs: MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS,
  writableTmpfsBytes: MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS_BYTES,
} as const satisfies ManagedWorkerImagePolicy

export function parseManagedWorkerImagePolicy(
  input: unknown,
): ManagedWorkerImagePolicy {
  return ManagedWorkerImagePolicySchema.parse(input)
}

export function parseUpstreamImageLock(input: unknown): UpstreamImageLock {
  return UpstreamImageLockSchema.parse(input)
}
