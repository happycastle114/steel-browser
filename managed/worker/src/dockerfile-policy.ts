import { z } from "zod"
import { WORKER_DOCKERFILE_OVERLAY } from "./dockerfile-overlay-policy.js"
import {
  MANAGED_WORKER_IMAGE_INPUT,
  MANAGED_WORKER_RUNTIME,
} from "./image-policy.js"
import { WORKER_RUNTIME_DEPENDENCY } from "./runtime-dependency-policy.js"

const FINAL_PRODUCTION_STAGE = "FROM scratch AS production" as const

const DockerfilePolicyReceiptSchema = z
  .object({
    finalBase: z.literal("scratch"),
    healthPath: z.literal(MANAGED_WORKER_RUNTIME.HEALTH_PATH),
    productionAudit: z.literal(true),
    runtimeDependencyGraph: z.literal(
      WORKER_RUNTIME_DEPENDENCY.GRAPH,
    ),
    sourceOverlay: z.literal(true),
    runtimePort: z.literal(MANAGED_WORKER_RUNTIME.PORT),
    upstreamImage: z.literal(MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_IMAGE),
    user: z.literal(
      `${MANAGED_WORKER_RUNTIME.UID}:${MANAGED_WORKER_RUNTIME.GID}`,
    ),
  })
  .strict()
  .readonly()

export type DockerfilePolicyReceipt = z.infer<
  typeof DockerfilePolicyReceiptSchema
>

export class WorkerDockerfilePolicyError extends Error {
  override readonly name = "WorkerDockerfilePolicyError"

  constructor(readonly policy: string) {
    super(`managed worker Dockerfile violates ${policy}`)
  }
}

function instructionLines(source: string): readonly string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

function requireLine(lines: readonly string[], expected: string, policy: string): void {
  if (!lines.includes(expected)) {
    throw new WorkerDockerfilePolicyError(policy)
  }
}

export function verifyWorkerDockerfile(source: string): DockerfilePolicyReceipt {
  const lines = instructionLines(source)
  const fromLines = lines.filter((line) => line.startsWith("FROM "))
  const expectedBuilder = `FROM ${MANAGED_WORKER_IMAGE_INPUT.BUILDER_IMAGE} AS build`
  const expectedRuntimeDependencies =
    `FROM ${MANAGED_WORKER_IMAGE_INPUT.BUILDER_IMAGE} AS runtime-dependencies`
  const expectedUpstream = `FROM ${MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_IMAGE} AS upstream`
  if (
    !fromLines.includes(expectedBuilder) ||
    !fromLines.includes(expectedRuntimeDependencies) ||
    !fromLines.includes(expectedUpstream)
  ) {
    throw new WorkerDockerfilePolicyError("digest-pinned build and upstream bases")
  }
  if (!fromLines.includes("FROM upstream AS prepared")) {
    throw new WorkerDockerfilePolicyError("prepared immutable upstream base")
  }
  if (!fromLines.includes("FROM scratch AS production-audit-export")) {
    throw new WorkerDockerfilePolicyError("production audit export stage")
  }
  if (!fromLines.includes("FROM runtime-dependencies AS production-audit")) {
    throw new WorkerDockerfilePolicyError("isolated production audit stage")
  }
  if (fromLines.at(-1) !== FINAL_PRODUCTION_STAGE) {
    throw new WorkerDockerfilePolicyError("scratch metadata reset")
  }
  requireLine(
    lines,
    `USER ${MANAGED_WORKER_RUNTIME.UID}:${MANAGED_WORKER_RUNTIME.GID}`,
    "numeric non-root identity",
  )
  requireLine(
    lines,
    WORKER_RUNTIME_DEPENDENCY.INSTALL,
    "selected production workspace dependency graph",
  )
  for (const overlay of WORKER_RUNTIME_DEPENDENCY.NATIVE_OVERLAYS) {
    requireLine(lines, overlay, "exact native dependency overlay")
  }
  for (const overlay of WORKER_DOCKERFILE_OVERLAY.RUNTIME) {
    requireLine(lines, overlay, "exact source-to-runtime overlay")
  }
  if (
    !source.includes(
      "node managed/worker/image/write-runtime-source-manifest.mjs runtime-source-manifest.json",
    )
  ) {
    throw new WorkerDockerfilePolicyError("runtime source manifest generation")
  }
  for (const auditBoundary of WORKER_DOCKERFILE_OVERLAY.AUDIT_BOUNDARIES) {
    if (!source.includes(auditBoundary)) {
      throw new WorkerDockerfilePolicyError("verified production dependency audit")
    }
  }
  if (
    !source.includes('ARG SOURCE_DATE_EPOCH') ||
    !source.includes('SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}"') ||
    !source.includes('dev.happycastle.steel.source-date-epoch="${SOURCE_DATE_EPOCH}"')
  ) {
    throw new WorkerDockerfilePolicyError("deterministic source epoch binding")
  }
  const userLines = lines.filter((line) => line.startsWith("USER "))
  if (
    userLines.at(-1) !==
    `USER ${MANAGED_WORKER_RUNTIME.UID}:${MANAGED_WORKER_RUNTIME.GID}`
  ) {
    throw new WorkerDockerfilePolicyError("final numeric non-root identity")
  }
  requireLine(lines, `EXPOSE ${MANAGED_WORKER_RUNTIME.PORT}`, "single private port")
  const exposeLines = lines.filter((line) => line.startsWith("EXPOSE "))
  if (
    exposeLines.length !== 1 ||
    exposeLines[0] !== `EXPOSE ${MANAGED_WORKER_RUNTIME.PORT}`
  ) {
    throw new WorkerDockerfilePolicyError("only the private supervisor port")
  }
  requireLine(
    lines,
    `HEALTHCHECK --interval=${MANAGED_WORKER_RUNTIME.HEALTH_INTERVAL_SECONDS}s --timeout=${MANAGED_WORKER_RUNTIME.HEALTH_PROBE_TIMEOUT_SECONDS}s --start-period=${MANAGED_WORKER_RUNTIME.HEALTH_START_PERIOD_SECONDS}s --retries=${MANAGED_WORKER_RUNTIME.HEALTH_RETRIES} CMD ["node", "/app/managed/worker/build/healthcheck.js"]`,
    "supervisor healthcheck",
  )
  requireLine(
    lines,
    'ENTRYPOINT ["node", "/app/managed/worker/build/cli.js"]',
    "supervisor entrypoint",
  )
  if (
    source.includes(":latest") ||
    source.includes("/var/run/docker.sock") ||
    source.includes("npm pkg set") ||
    source.includes("--no-sandbox") ||
    source.includes("--disable-setuid-sandbox")
  ) {
    throw new WorkerDockerfilePolicyError("no floating image or Docker socket")
  }
  if (
    !source.includes(
      'dev.happycastle.steel.browser.version-proof="RUNTIME_READBACK_REQUIRED"',
    )
  ) {
    throw new WorkerDockerfilePolicyError("runtime browser-version proof receipt")
  }
  for (const [label, bytes] of [
    ["memory-current-max", MANAGED_WORKER_RUNTIME.MAX_MEMORY_CURRENT_BYTES],
    ["memory-limit", MANAGED_WORKER_RUNTIME.MEMORY_LIMIT_BYTES],
    ["memory-reservation", MANAGED_WORKER_RUNTIME.MEMORY_RESERVATION_BYTES],
    ["shm", MANAGED_WORKER_RUNTIME.SHM_BYTES],
  ] as const) {
    if (!source.includes(`dev.happycastle.steel.worker.${label}="${bytes}"`)) {
      throw new WorkerDockerfilePolicyError("exact worker memory contract labels")
    }
  }
  requireLine(
    lines,
    "COPY managed/worker/image/upstream-image.lock.json /licenses/steel-browser/upstream-image.lock.json",
    "embedded upstream image registry receipt",
  )
  for (const mount of MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS) {
    const bytes = MANAGED_WORKER_RUNTIME.WRITABLE_TMPFS_BYTES[mount]
    if (
      !source.includes(
        `dev.happycastle.steel.worker.tmpfs.${mount}="${bytes}"`,
      )
    ) {
      throw new WorkerDockerfilePolicyError("exact writable tmpfs labels")
    }
  }
  for (const link of [
    "ln -s /tmp/files /files",
    "ln -s /tmp/cache /app/.cache",
    "ln -s /var/lib/steel/profile/persist /app/api/user-data-dir",
  ]) {
    if (!source.includes(link)) {
      throw new WorkerDockerfilePolicyError("read-only runtime symlink layout")
    }
  }
  return DockerfilePolicyReceiptSchema.parse({
    finalBase: "scratch",
    healthPath: MANAGED_WORKER_RUNTIME.HEALTH_PATH,
    productionAudit: true,
    runtimeDependencyGraph: WORKER_RUNTIME_DEPENDENCY.GRAPH,
    sourceOverlay: true,
    runtimePort: MANAGED_WORKER_RUNTIME.PORT,
    upstreamImage: MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_IMAGE,
    user: `${MANAGED_WORKER_RUNTIME.UID}:${MANAGED_WORKER_RUNTIME.GID}`,
  })
}
