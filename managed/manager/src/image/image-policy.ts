import { z } from "zod"

export const MANAGED_MANAGER_IMAGE_INPUT = {
  NODE_BUILDER:
    "docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37",
  NODE_RUNTIME:
    "docker.io/library/node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3",
  RUST_BUILDER:
    "docker.io/library/rust:1.91.1-bookworm@sha256:c1e5f19e773b7878c3f7a805dd00a495e747acbdc76fb2337a4ebf0418896b33",
} as const

const MANAGED_MANAGER_PLATFORM_DIGESTS = {
  nodeBuilder: {
    "linux/amd64": "sha256:175215a1f306ed5df592434b99cc2019f70624373fe49cb659240a618a846aed",
    "linux/arm64": "sha256:63c7334e154f369954e1d59c0299a4eb24f4f8e197d197fba8c7de259e69302b",
  },
  nodeRuntime: {
    "linux/amd64": "sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27",
    "linux/arm64": "sha256:ef03a3d0e663b3c9d38c95be3fd31a100514d41df2599562b68a58a57f979adf",
  },
  rustBuilder: {
    "linux/amd64": "sha256:8322627e69ba7780b54f39e9f4d3758c006a3ae0123ea01d63b91f0626169891",
    "linux/arm64": "sha256:20262682d0201e219012287e8c1e6a7a14b6ebd46bb2b280714f23c06678c285",
  },
} as const

export const MANAGED_MANAGER_RUNTIME = {
  CONSOLE_MANIFEST: "/srv/steel-console/asset-manifest.json",
  CONSOLE_ROOT: "/srv/steel-console",
  GID: 10_001,
  HEALTHCHECK: "/usr/local/bin/steel-manager-healthcheck",
  HEALTH_PATH: "/livez",
  HEALTH_PORT: 3_001,
  INIT: "/usr/local/bin/steel-manager-init",
  MANAGER: "/usr/local/bin/steel-managed-manager",
  NODE_VERSION: "22.23.1",
  PUBLIC_PORT: 3_000,
  RELEASE_EVIDENCE_SOURCE: "/run/steel-release-evidence-source/release-evidence.json",
  RELEASE_EVIDENCE_TARGET: "/run/steel/managed-release-evidence.json",
  RUST_VERSION: "1.91.1",
  UID: 10_001,
} as const

const ManagedManagerImagePolicySchema = z
  .object({
    browserIncluded: z.literal(false),
    capabilities: z.tuple([
      z.literal("CHOWN"),
      z.literal("SETGID"),
      z.literal("SETPCAP"),
      z.literal("SETUID"),
    ]),
    consoleManifest: z.literal(MANAGED_MANAGER_RUNTIME.CONSOLE_MANIFEST),
    consoleRoot: z.literal(MANAGED_MANAGER_RUNTIME.CONSOLE_ROOT),
    dockerSocket: z.literal(false),
    gid: z.literal(MANAGED_MANAGER_RUNTIME.GID),
    gitIncluded: z.literal(false),
    healthPath: z.literal(MANAGED_MANAGER_RUNTIME.HEALTH_PATH),
    healthPort: z.literal(MANAGED_MANAGER_RUNTIME.HEALTH_PORT),
    initUid: z.literal(0),
    nodeBuilder: z.literal(MANAGED_MANAGER_IMAGE_INPUT.NODE_BUILDER),
    nodeRuntime: z.literal(MANAGED_MANAGER_IMAGE_INPUT.NODE_RUNTIME),
    nodeVersion: z.literal(MANAGED_MANAGER_RUNTIME.NODE_VERSION),
    persistentStorage: z.literal(false),
    privileged: z.literal(false),
    publicPort: z.literal(MANAGED_MANAGER_RUNTIME.PUBLIC_PORT),
    readOnlyRootFileSystem: z.literal(true),
    rustBuilder: z.literal(MANAGED_MANAGER_IMAGE_INPUT.RUST_BUILDER),
    rustVersion: z.literal(MANAGED_MANAGER_RUNTIME.RUST_VERSION),
    runtimeUid: z.literal(MANAGED_MANAGER_RUNTIME.UID),
  })
  .strict()
  .readonly()
export type ManagedManagerImagePolicy = z.infer<typeof ManagedManagerImagePolicySchema>

export const MANAGED_MANAGER_IMAGE_POLICY = {
  browserIncluded: false,
  capabilities: ["CHOWN", "SETGID", "SETPCAP", "SETUID"],
  consoleManifest: MANAGED_MANAGER_RUNTIME.CONSOLE_MANIFEST,
  consoleRoot: MANAGED_MANAGER_RUNTIME.CONSOLE_ROOT,
  dockerSocket: false,
  gid: MANAGED_MANAGER_RUNTIME.GID,
  gitIncluded: false,
  healthPath: MANAGED_MANAGER_RUNTIME.HEALTH_PATH,
  healthPort: MANAGED_MANAGER_RUNTIME.HEALTH_PORT,
  initUid: 0,
  nodeBuilder: MANAGED_MANAGER_IMAGE_INPUT.NODE_BUILDER,
  nodeRuntime: MANAGED_MANAGER_IMAGE_INPUT.NODE_RUNTIME,
  nodeVersion: MANAGED_MANAGER_RUNTIME.NODE_VERSION,
  persistentStorage: false,
  privileged: false,
  publicPort: MANAGED_MANAGER_RUNTIME.PUBLIC_PORT,
  readOnlyRootFileSystem: true,
  rustBuilder: MANAGED_MANAGER_IMAGE_INPUT.RUST_BUILDER,
  rustVersion: MANAGED_MANAGER_RUNTIME.RUST_VERSION,
  runtimeUid: MANAGED_MANAGER_RUNTIME.UID,
} as const satisfies ManagedManagerImagePolicy

export function parseManagedManagerImagePolicy(input: unknown): ManagedManagerImagePolicy {
  return ManagedManagerImagePolicySchema.parse(input)
}

const SourceReceiptSchema = z
  .object({
    baseImageReceipt: z.literal("base-images.lock.json"),
    build: z
      .object({
        auditReceiptProof: z.literal("OCI_LABEL_AND_RUNTIME_SHA256"),
        method: z.literal("GIT_ARCHIVE_TWO_ATTEMPT_REGISTRY_READBACK"),
        script: z.literal("managed/manager/image/build-reproducible.sh"),
      })
      .strict(),
    console: z
      .object({
        manifest: z.literal(MANAGED_MANAGER_RUNTIME.CONSOLE_MANIFEST),
        proof: z.literal("STARTUP_SHA256_READBACK"),
        root: z.literal(MANAGED_MANAGER_RUNTIME.CONSOLE_ROOT),
      })
      .strict(),
    license: z.literal("Apache-2.0"),
    repository: z.string().url(),
    runtime: z
      .object({
        healthcheck: z.literal(MANAGED_MANAGER_RUNTIME.HEALTHCHECK),
        init: z.literal(MANAGED_MANAGER_RUNTIME.INIT),
        manager: z.literal(MANAGED_MANAGER_RUNTIME.MANAGER),
        nodeVersion: z.literal(MANAGED_MANAGER_RUNTIME.NODE_VERSION),
        productionAuditReceipt: z.literal(
          "/app/managed/production-dependency-audit.json",
        ),
        runtimeSourceManifest: z.literal("/licenses/steel-manager/runtime-source-manifest.json"),
        rustVersion: z.literal(MANAGED_MANAGER_RUNTIME.RUST_VERSION),
        releaseEvidence: z
          .object({
            mode: z.literal("CONFIG_FILE"),
            source: z.literal(MANAGED_MANAGER_RUNTIME.RELEASE_EVIDENCE_SOURCE),
            target: z.literal(MANAGED_MANAGER_RUNTIME.RELEASE_EVIDENCE_TARGET),
          })
          .strict(),
      })
      .strict(),
    schemaVersion: z.literal(1),
    sourceRevisionProof: z.literal("OCI_REVISION_AND_RUNTIME_SOURCE_MANIFEST"),
  })
  .strict()
  .readonly()

const BaseImageEntrySchema = z
  .object({
    platforms: z.object({ "linux/amd64": z.string(), "linux/arm64": z.string() }).strict(),
    reference: z.string().regex(/@sha256:[0-9a-f]{64}$/u),
    registry: z.literal("registry-1.docker.io"),
  })
  .strict()
const BaseImageReceiptSchema = z
  .object({
    images: z
      .object({
        nodeBuilder: BaseImageEntrySchema.extend({
          platforms: z
            .object({
              "linux/amd64": z.literal(MANAGED_MANAGER_PLATFORM_DIGESTS.nodeBuilder["linux/amd64"]),
              "linux/arm64": z.literal(MANAGED_MANAGER_PLATFORM_DIGESTS.nodeBuilder["linux/arm64"]),
            })
            .strict(),
          reference: z.literal(MANAGED_MANAGER_IMAGE_INPUT.NODE_BUILDER),
        }),
        nodeRuntime: BaseImageEntrySchema.extend({
          platforms: z
            .object({
              "linux/amd64": z.literal(MANAGED_MANAGER_PLATFORM_DIGESTS.nodeRuntime["linux/amd64"]),
              "linux/arm64": z.literal(MANAGED_MANAGER_PLATFORM_DIGESTS.nodeRuntime["linux/arm64"]),
            })
            .strict(),
          reference: z.literal(MANAGED_MANAGER_IMAGE_INPUT.NODE_RUNTIME),
        }),
        rustBuilder: BaseImageEntrySchema.extend({
          platforms: z
            .object({
              "linux/amd64": z.literal(MANAGED_MANAGER_PLATFORM_DIGESTS.rustBuilder["linux/amd64"]),
              "linux/arm64": z.literal(MANAGED_MANAGER_PLATFORM_DIGESTS.rustBuilder["linux/arm64"]),
            })
            .strict(),
          reference: z.literal(MANAGED_MANAGER_IMAGE_INPUT.RUST_BUILDER),
        }),
      })
      .strict(),
    observedDate: z.literal("2026-07-21"),
    schemaVersion: z.literal(1),
  })
  .strict()
  .readonly()

export function parseManagerSourceReceipt(input: unknown): z.infer<typeof SourceReceiptSchema> {
  return SourceReceiptSchema.parse(input)
}

export function parseManagerBaseImageReceipt(input: unknown): z.infer<typeof BaseImageReceiptSchema> {
  return BaseImageReceiptSchema.parse(input)
}
