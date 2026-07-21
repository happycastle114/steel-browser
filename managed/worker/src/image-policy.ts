import { z } from "zod"

export const MANAGED_WORKER_IMAGE_INPUT = {
  BROWSER_VERSION_PROOF: "RUNTIME_READBACK_REQUIRED",
  BUILDER_IMAGE:
    "docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37",
  UPSTREAM_IMAGE:
    "ghcr.io/steel-dev/steel-browser@sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d",
  UPSTREAM_REVISION: "c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2",
} as const

export const MANAGED_WORKER_RUNTIME = {
  GID: 10001,
  HEALTH_PATH: "/v1/managed-worker/meta",
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
    createdDate: z.literal("2026-07-06"),
    indexDigest: z.literal(
      "sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d",
    ),
    packageVersion: z.literal("1004247379"),
    platforms: z
      .object({
        "linux/amd64": z
          .object({
            attestationDigest: z.literal(
              "sha256:83e60224db0f37ee2f16d0fbffeee6d81bcc3c500e884c7f560008244609d2de",
            ),
            configDigest: z.literal(
              "sha256:397f07eee40d08d1dc3bb6a6a34647a6e7eaa91f5432a9573c08ceabc5cc8815",
            ),
            subjectDigest: z.literal(
              "sha256:556402b20a178fb373b0b247f24d5be6fb3e3cf8d31ce7d25387f0e7a0247535",
            ),
          })
          .strict()
          .readonly(),
        "linux/arm64": z
          .object({
            attestationDigest: z.literal(
              "sha256:c3d6bc38042bdd90cf46e202200c9b505e174b5070b3db70948408dce9c7a4d7",
            ),
            configDigest: z.literal(
              "sha256:1913e642c9d9550131bd1a14ed06913c63a9cb41261ee95b2104fd45cd186409",
            ),
            subjectDigest: z.literal(
              "sha256:89fbce4260b09264d4e49771de6d304bba683e9c462b7a4ffc417b48c0a58646",
            ),
          })
          .strict()
          .readonly(),
      })
      .strict()
      .readonly(),
    provenance: z
      .object({
        githubActionsRunId: z.literal("28784462621"),
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
