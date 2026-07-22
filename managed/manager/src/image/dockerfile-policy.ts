import { z } from "zod"
import {
  MANAGED_MANAGER_IMAGE_INPUT,
  MANAGED_MANAGER_RUNTIME,
} from "./image-policy.js"

const DockerfileReceiptSchema = z
  .object({
    finalBase: z.literal("scratch"),
    healthcheck: z.literal(MANAGED_MANAGER_RUNTIME.HEALTHCHECK),
    init: z.literal(MANAGED_MANAGER_RUNTIME.INIT),
    publicPort: z.literal(MANAGED_MANAGER_RUNTIME.PUBLIC_PORT),
    runtimeRoot: z.literal("scratch"),
  })
  .strict()
  .readonly()

export class ManagerDockerfilePolicyError extends Error {
  public override readonly name = "ManagerDockerfilePolicyError"

  public constructor(public readonly policy: string) {
    super(`managed manager Dockerfile violates ${policy}`)
  }
}

export function verifyManagerDockerfile(source: string): z.infer<typeof DockerfileReceiptSchema> {
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
  const fromLines = lines.filter((line) => line.startsWith("FROM "))
  requireLine(fromLines, `FROM ${MANAGED_MANAGER_IMAGE_INPUT.NODE_BUILDER} AS node-build`, "Node builder pin")
  requireLine(fromLines, `FROM ${MANAGED_MANAGER_IMAGE_INPUT.NODE_BUILDER} AS runtime-dependencies`, "runtime dependency builder pin")
  requireLine(fromLines, "FROM runtime-dependencies AS runtime-entry-check", "runtime entry check stage")
  requireLine(fromLines, `FROM ${MANAGED_MANAGER_IMAGE_INPUT.RUST_BUILDER} AS init-build`, "Rust builder pin")
  requireLine(fromLines, `FROM ${MANAGED_MANAGER_IMAGE_INPUT.NODE_RUNTIME} AS runtime-files`, "Node runtime pin")
  if (fromLines.at(-1) !== "FROM scratch AS production") fail("scratch final root")
  requireLine(lines, "USER 0:0", "root init identity")
  requireLine(lines, `EXPOSE ${MANAGED_MANAGER_RUNTIME.PUBLIC_PORT}`, "single public port")
  if (lines.filter((line) => line.startsWith("EXPOSE ")).length !== 1) fail("single public port")
  requireLine(
    lines,
    `HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 CMD ["${MANAGED_MANAGER_RUNTIME.HEALTHCHECK}", "http://127.0.0.1:${MANAGED_MANAGER_RUNTIME.HEALTH_PORT}${MANAGED_MANAGER_RUNTIME.HEALTH_PATH}"]`,
    "loopback healthcheck",
  )
  requireLine(lines, `ENTRYPOINT ["${MANAGED_MANAGER_RUNTIME.INIT}"]`, "PID1 init")
  requireLine(lines, "COPY --from=runtime-files /runtime-root /", "minimal runtime root")
  requireLine(
    lines,
    `COPY --from=node-build /workspace/managed/console/dist ${MANAGED_MANAGER_RUNTIME.CONSOLE_ROOT}`,
    "console artifact",
  )
  for (const binary of [
    MANAGED_MANAGER_RUNTIME.HEALTHCHECK,
    MANAGED_MANAGER_RUNTIME.INIT,
    MANAGED_MANAGER_RUNTIME.MANAGER,
  ]) {
    if (!source.includes(binary)) fail("required runtime binaries")
  }
  for (const proof of [
    "asset-manifest-cli.js managed/console/dist",
    "write-runtime-source-manifest.mjs runtime-source-manifest.json",
    'dev.happycastle.steel.manager.runtime-uid="10001"',
    'dev.happycastle.steel.manager.console-proof="STARTUP_SHA256_READBACK"',
    `/runtime-root${MANAGED_MANAGER_RUNTIME.RELEASE_EVIDENCE_SOURCE.slice(0, MANAGED_MANAGER_RUNTIME.RELEASE_EVIDENCE_SOURCE.lastIndexOf("/"))}`,
    "node managed/security/prune-production-tree.mjs --target MANAGER --root /runtime-deps",
    "node managed/security/generate-native-overlay-evidence.mjs",
    "node managed/security/verify-production-audit.mjs",
    "COPY --from=production-audit-input /production-dependency-audit.json",
    'dev.happycastle.steel.production-audit.sha256="${MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256}"',
    "COPY --from=runtime-dependencies /runtime-deps/node_modules /app/node_modules",
    'RUN node --input-type=module -e \'await import("file:///runtime-deps/managed/shared/build/index.js")\'',
    "COPY --from=runtime-entry-check /runtime-deps/managed/shared/build /app/managed/shared/build",
    "COPY managed/tsconfig.base.json ./managed/tsconfig.base.json",
    "COPY --from=node-build /etc/ssl/certs/ca-certificates.crt /runtime-input/ca-certificates.crt",
    "install -m 0444 /runtime-input/ca-certificates.crt /runtime-root/etc/ssl/certs/ca-certificates.crt",
    "sha256sum /runtime-root/app/managed/production-dependency-audit.json",
  ]) {
    if (!source.includes(proof)) fail("source and console proof")
  }
  for (const forbidden of [":latest", "/var/run/docker.sock", "chromium", "EXPOSE 3001", "VOLUME "]) {
    if (source.includes(forbidden)) fail("forbidden runtime surface")
  }
  return DockerfileReceiptSchema.parse({
    finalBase: "scratch",
    healthcheck: MANAGED_MANAGER_RUNTIME.HEALTHCHECK,
    init: MANAGED_MANAGER_RUNTIME.INIT,
    publicPort: MANAGED_MANAGER_RUNTIME.PUBLIC_PORT,
    runtimeRoot: "scratch",
  })
}

function requireLine(lines: readonly string[], expected: string, policy: string): void {
  if (!lines.includes(expected)) fail(policy)
}

function fail(policy: string): never {
  throw new ManagerDockerfilePolicyError(policy)
}
