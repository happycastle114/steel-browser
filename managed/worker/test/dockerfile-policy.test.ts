import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { verifyWorkerDockerfile } from "../src/dockerfile-policy.js"

const dockerfilePath = fileURLToPath(
  new URL("../image/Dockerfile", import.meta.url),
)

describe("managed worker Dockerfile policy", () => {
  it("accepts the checked-in deterministic worker image", () => {
    // Given
    const source = readFileSync(dockerfilePath, "utf8")

    // When
    const receipt = verifyWorkerDockerfile(source)

    // Then
    expect(receipt).toEqual({
      finalBase: "scratch",
      healthPath: "/v1/managed-worker/meta",
      productionAudit: true,
      runtimeDependencyGraph: "SELECTED_WORKSPACES",
      runtimePort: 3000,
      sourceOverlay: true,
      upstreamImage:
        "ghcr.io/steel-dev/steel-browser@sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d",
      user: "10001:10001",
    })
  })

  it.each([
    ["floating upstream", /@sha256:[0-9a-f]{64}/, ":latest"],
    ["inherited metadata", "FROM scratch AS production", "FROM upstream AS production"],
    ["mutable prepared base", "FROM upstream AS prepared", "FROM ghcr.io/steel-dev/steel-browser:latest AS prepared"],
    ["root user", "USER 10001:10001", "USER 0:0"],
    ["debugger exposure", "EXPOSE 3000", "EXPOSE 3000 9223"],
    ["extra exposure", "EXPOSE 3000", "EXPOSE 3000\nEXPOSE 8080"],
    ["missing health", "HEALTHCHECK --interval", "# HEALTHCHECK --interval"],
    ["startup grace drift", "--start-period=90s", "--start-period=15s"],
    ["wrong entrypoint", "build/cli.js", "api/build/index.js"],
    ["socket mount", "WORKDIR /app", "WORKDIR /app\nVOLUME /var/run/docker.sock"],
    ["tmpfs drift", "dev.happycastle.steel.worker.tmpfs./run/steel=", "dev.happycastle.steel.worker.tmpfs./run/drift="],
    ["tmpfs byte drift", "67108864", "67108863"],
    ["memory current drift", "memory-current-max=\"671088640\"", "memory-current-max=\"671088641\""],
    ["memory limit drift", "memory-limit=\"2684354560\"", "memory-limit=\"2147483648\""],
    ["memory reservation drift", "memory-reservation=\"1342177280\"", "memory-reservation=\"1073741824\""],
    ["shm drift", "worker.shm=\"536870912\"", "worker.shm=\"268435456\""],
    ["missing profile symlink", "ln -s /var/lib/steel/profile/persist /app/api/user-data-dir", "ln -s /tmp/profile /app/api/user-data-dir"],
    ["browser proof drift", "RUNTIME_READBACK_REQUIRED", "999.0.0.0"],
    ["missing registry receipt", "COPY managed/worker/image/upstream-image.lock.json", "# COPY managed/worker/image/upstream-image.lock.json"],
    ["missing API overlay", "COPY --from=build /workspace/api/build /app/api/build", "# COPY --from=build /workspace/api/build /app/api/build"],
    ["missing API dependency overlay", "COPY --from=runtime-dependencies /runtime-deps/api/node_modules /app/api/node_modules", "# COPY --from=runtime-dependencies /runtime-deps/api/node_modules /app/api/node_modules"],
    ["script-enabled runtime install", "npm ci --ignore-scripts --omit=dev", "npm ci --foreground-scripts --omit=dev"],
    ["workspace-root runtime install", "--include-workspace-root=false", "--include-workspace-root=true"],
    ["source package mutation", "RUN HUSKY=0 npm ci --include=dev", "RUN npm pkg set scripts.prepare=skip && npm ci --include=dev"],
    ["missing classic-level native overlay", "COPY --from=build /workspace/node_modules/classic-level", "# COPY --from=build /workspace/node_modules/classic-level"],
    ["missing duckdb native overlay", "COPY --from=build /workspace/node_modules/duckdb", "# COPY --from=build /workspace/node_modules/duckdb"],
    ["missing native evidence", "node managed/security/generate-native-overlay-evidence.mjs", "node managed/security/missing-native-evidence.mjs"],
    ["missing production pruner", "node managed/security/prune-production-tree.mjs", "node managed/security/missing-production-pruner.mjs"],
    ["mutable audit registry", "--registry=https://registry.npmjs.org", "--registry=https://mirror.invalid"],
    ["missing production audit verifier", "node managed/security/verify-production-audit.mjs", "node managed/security/missing-production-audit.mjs"],
    ["missing production audit bytes", "COPY --from=production-audit-input /production-dependency-audit.json", "# COPY --from=production-audit-input /production-dependency-audit.json"],
    ["missing production audit digest label", "dev.happycastle.steel.production-audit.sha256=", "dev.happycastle.steel.production-audit.unbound="],
    ["missing recorder overlay", "COPY --from=build /workspace/api/extensions/recorder/dist", "# COPY --from=build /workspace/api/extensions/recorder/dist"],
    ["missing shared overlay", "COPY --from=build /workspace/managed/shared/build", "# COPY --from=build /workspace/managed/shared/build"],
    ["missing lock overlay", "COPY --from=build /workspace/package-lock.json /app/package-lock.json", "# COPY --from=build /workspace/package-lock.json /app/package-lock.json"],
    ["missing source epoch", "dev.happycastle.steel.source-date-epoch=", "dev.happycastle.steel.source-epoch="],
    ["sandbox bypass", "ENTRYPOINT", "ENV CHROME_ARGS=--no-sandbox\nENTRYPOINT"],
  ])("rejects the %s mutation", (_name, search, replacement) => {
    // Given
    const source = readFileSync(dockerfilePath, "utf8")
    const mutated = source.replace(search, replacement)

    // When
    const verify = () => verifyWorkerDockerfile(mutated)

    // Then
    expect(mutated).not.toBe(source)
    expect(verify).toThrow()
  })
})
