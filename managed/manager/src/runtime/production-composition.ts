import { randomUUID } from "node:crypto"
import { WorkerHttpAdapter } from "@happycastle/steel-managed-gateway"
import {
  BootIdSchema,
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_FIXED,
  CreateTokenKeyIdSchema,
  ManagedReleaseEvidenceSchema,
  ManagerInstanceIdSchema,
  VersionSchema,
  computeSecretFingerprint,
  type ManagedReleaseEvidence,
  type Version,
} from "@happycastle/steel-managed-shared"
import { AccessJwtAuthenticator } from "../auth/jwt-authenticator.js"
import { CloudflareJwksFetcher } from "../auth/cloudflare-jwks-fetcher.js"
import { JwksKeyStore } from "../auth/jwks-key-store.js"
import { loadManagerConfigReceipt } from "../config.js"
import { parseManagerArguments } from "../launch-config.js"
import { loadVerifiedReleaseEvidenceFile } from "../release/release-evidence.js"
import {
  MANAGER_RUNTIME_GID,
  MANAGER_RUNTIME_UID,
  loadCreateTokenKeyFile,
} from "../secret/create-token-key.js"
import { loadVerifiedUiAssetManifest } from "../ui/asset-manifest.js"
import { createManagerApplication } from "./manager-application.js"
import type { ManagerApplicationClock } from "./manager-application-context.js"

const WORKER_RESPONSE_BYTES = 1_048_576

export type ProductionManagerRuntimeInput = Readonly<{
  arguments: readonly string[]
  environment: Readonly<Record<string, string | undefined>>
}>

type ProductionManagerRuntime = Readonly<{
  close(): Promise<void>
  start(): Promise<void>
}>

export async function createProductionManagerRuntime(
  input: ProductionManagerRuntimeInput,
): Promise<ProductionManagerRuntime> {
  const launch = parseManagerArguments(input.arguments)
  const configReceipt = loadManagerConfigReceipt(input.environment, launch.poolId)
  const release = await loadVerifiedReleaseEvidenceFile({
    expectedGid: MANAGER_RUNTIME_GID,
    expectedSha256: launch.releaseEvidenceSha256,
    expectedUid: MANAGER_RUNTIME_UID,
    path: launch.releaseEvidencePath,
    schema: ManagedReleaseEvidenceSchema,
  })
  const createTokenKey = await loadCreateTokenKeyFile({
    expectedGid: MANAGER_RUNTIME_GID,
    expectedUid: MANAGER_RUNTIME_UID,
    path: launch.tokenKeyPath,
  })
  let fetcher: CloudflareJwksFetcher | undefined
  let workerClient: WorkerHttpAdapter | undefined
  try {
    const clock = systemClock()
    fetcher = new CloudflareJwksFetcher({
      clock,
      issuer: configReceipt.config.controlPlane.accessIssuer,
      timeoutMilliseconds: configReceipt.config.controlPlane.probeTimeoutMs,
    })
    const authenticator = new AccessJwtAuthenticator({
      audiences: [
        configReceipt.config.controlPlane.accessAudience,
        ...configReceipt.config.controlPlane.additionalAccessAudiences,
      ],
      clock,
      issuer: configReceipt.config.controlPlane.accessIssuer,
      keyStore: new JwksKeyStore({ clock, fetcher }),
      maxTokenTtlSeconds: configReceipt.config.controlPlane.accessMaxTokenTtlSeconds,
      operatorServicePrincipals: configReceipt.config.controlPlane.operatorServicePrincipals,
      operatorUserEmails: configReceipt.config.controlPlane.operatorUserEmails,
      skewSeconds: CONTROL_PLANE_FIXED.accessClockSkewSeconds,
    })
    workerClient = new WorkerHttpAdapter({
      maxResponseBytes: WORKER_RESPONSE_BYTES,
      timeoutMilliseconds: Math.max(
        configReceipt.config.controlPlane.probeTimeoutMs,
        configReceipt.config.controlPlane.createTimeoutMs,
        configReceipt.config.controlPlane.releaseTimeoutMs,
      ),
    })
    const managerInstanceId = ManagerInstanceIdSchema.parse(randomUUID())
    const fingerprint = createTokenKey.withBytes(computeSecretFingerprint)
    const uiManifest = await loadVerifiedUiAssetManifest(configReceipt.config.uiAssetRoot)
    return createManagerApplication({
      authenticate: (headers) => authenticator.authenticate(headers),
      bootId: BootIdSchema.parse(randomUUID()),
      clock,
      closeExternalDependencies: async () => {
        await fetcher?.close()
      },
      config: configReceipt.config,
      createTokenKey,
      launch,
      managerInstanceId,
      onError: reportRuntimeError,
      uiAssets: { manifest: uiManifest, root: configReceipt.config.uiAssetRoot },
      version: buildVersion({
        configSha256: configReceipt.sha256,
        createTokenKeyId: fingerprint.createTokenKeyId,
        evidence: release.evidence,
        evidenceSha256: release.sha256,
        startedAt: new Date(clock.now()).toISOString(),
      }),
      workerClient,
    })
  } catch (error) {
    createTokenKey.destroy()
    await Promise.allSettled([
      fetcher?.close() ?? Promise.resolve(),
      workerClient?.close() ?? Promise.resolve(),
    ])
    throw error
  }
}

export function buildVersion(input: Readonly<{
  configSha256: string
  createTokenKeyId: string
  evidence: ManagedReleaseEvidence
  evidenceSha256: string
  startedAt: string
}>): Version {
  return VersionSchema.parse({
    apiVersion: CONTROL_PLANE_API_VERSION,
    upstreamSha: input.evidence.body.source.upstreamRevision,
    managedSha: input.evidence.body.source.managedRevision,
    managerDigest: input.evidence.body.managerImage.indexDigest,
    workerDigest: input.evidence.body.workerImage.indexDigest,
    browserVersion: input.evidence.body.browserVersion,
    toolchainLockSha256: input.evidence.body.toolchainLockSha256,
    managerConfigSha256: input.configSha256,
    releaseEvidenceSha256: input.evidenceSha256,
    releaseEvidenceMode: input.evidence.evidenceMode,
    createTokenKeyId: CreateTokenKeyIdSchema.parse(input.createTokenKeyId.slice(0, 16)),
    startedAt: input.startedAt,
  })
}

function systemClock(): ManagerApplicationClock {
  return { now: () => Date.now(), nowMilliseconds: () => Date.now() }
}

function reportRuntimeError(error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError"
  process.stderr.write(`[steel-managed-manager] ${name}\n`)
}
