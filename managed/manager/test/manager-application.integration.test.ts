import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  InstanceIdSchema,
  WorkerDescriptorSchema,
  WorkerRemoteState,
  type StaticWorkerEndpoint,
  type WorkerDescriptor,
} from "@happycastle/steel-managed-gateway"
import {
  BootIdSchema,
  CONTROL_PLANE_API_VERSION,
  MANAGED_RELEASE_EVIDENCE_MODE,
  ManagerInstanceIdSchema,
  PRINCIPAL_KIND,
  PRINCIPAL_ROLE,
  PrincipalIdSchema,
  VersionSchema,
} from "@happycastle/steel-managed-shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseManagerConfig } from "../src/config.js"
import { parseManagerArguments } from "../src/launch-config.js"
import { createManagerApplication } from "../src/runtime/manager-application.js"
import { CreateTokenKeyMaterial } from "../src/secret/create-token-key.js"
import { writeUiAssetManifest } from "../src/ui/asset-manifest.js"
import { validManagerConfigInput, validPoolId } from "./fixtures.js"

describe("manager application integration", () => {
  let uiRoot: string

  beforeEach(async () => {
    uiRoot = await mkdtemp(path.join(tmpdir(), "steel-manager-app-ui-"))
    await writeFile(path.join(uiRoot, "index.html"), "<!doctype html><main>Steel manager</main>")
  })

  afterEach(async () => {
    await rm(uiRoot, { force: true, recursive: true })
  })

  it("serves operations, AI discovery, and console routes from one authenticated app", async () => {
    const config = parseManagerConfig(validManagerConfigInput(), validPoolId())
    const launch = parseManagerArguments(managerArguments())
    const manifest = await writeUiAssetManifest(uiRoot)
    const runtime = createManagerApplication({
      authenticate: async () => ({
        id: PrincipalIdSchema.parse("USER:application-test"),
        kind: PRINCIPAL_KIND.USER,
        role: PRINCIPAL_ROLE.USER,
      }),
      bootId: BootIdSchema.parse("00000000-0000-4000-8000-000000000201"),
      clock: { now: () => 1_000, nowMilliseconds: () => 1_000 },
      config,
      createTokenKey: new CreateTokenKeyMaterial(Buffer.alloc(32, 9)),
      launch,
      managerInstanceId: ManagerInstanceIdSchema.parse("00000000-0000-4000-8000-000000000301"),
      uiAssets: { manifest, root: uiRoot },
      version: VersionSchema.parse({
        apiVersion: CONTROL_PLANE_API_VERSION,
        upstreamSha: "1".repeat(40),
        managedSha: "2".repeat(40),
        managerDigest: `sha256:${"3".repeat(64)}`,
        workerDigest: `sha256:${"4".repeat(64)}`,
        browserVersion: "150.0.7871.46",
        toolchainLockSha256: "5".repeat(64),
        managerConfigSha256: "6".repeat(64),
        releaseEvidenceSha256: "7".repeat(64),
        releaseEvidenceMode: MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE,
        createTokenKeyId: "8".repeat(16),
        startedAt: new Date(1_000).toISOString(),
      }),
      workerClient: workerClient(),
    })
    await runtime.publicServer().ready()
    const headers = { host: "steel.example.com" }

    const version = await runtime.publicServer().inject({ headers, method: "GET", url: "/v1/managed/version" })
    const tools = await runtime.publicServer().inject({ headers, method: "GET", url: "/v1/tools" })
    const ui = await runtime.publicServer().inject({ headers, method: "GET", url: "/ui/" })

    expect(version.statusCode).toBe(200)
    expect(tools.statusCode).toBe(200)
    expect(tools.json().items).toHaveLength(14)
    expect(ui.body).toContain("Steel manager")
    await runtime.close()
  })
})

function managerArguments(): readonly string[] {
  return [
    "--pool-id=managed-blue-pool",
    "--worker=worker-00=http://worker-00:3000",
    "--worker=worker-01=http://worker-01:3000",
    "--public-bind=0.0.0.0:3000",
    "--health-bind=127.0.0.1:3001",
    "--create-token-key-file=/run/steel/managed-create-token-key",
    "--release-evidence-file=/run/steel/managed-release-evidence.json",
    `--release-evidence-sha256=${"a".repeat(64)}`,
  ]
}

function workerClient() {
  return {
    assertCurrent: async (_worker: WorkerDescriptor) => undefined,
    close: async () => undefined,
    create: async () => { throw new TypeError("create not expected") },
    list: async () => { throw new TypeError("list not expected") },
    probe: async (endpoint: StaticWorkerEndpoint) => ({
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
      worker: WorkerDescriptorSchema.parse({
        instanceId: InstanceIdSchema.parse(
          endpoint.workerId === "worker-00"
            ? "00000000-0000-4000-8000-000000000401"
            : "00000000-0000-4000-8000-000000000402",
        ),
        origin: endpoint.origin,
        workerId: endpoint.workerId,
      }),
    }),
    release: async () => undefined,
  }
}
