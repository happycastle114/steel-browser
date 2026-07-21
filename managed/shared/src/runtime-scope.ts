import { z } from "zod"

import { withDeepFrozenOutput } from "./deep-readonly.js"
import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"
import {
  COOLIFY_PRODUCTION_OWNER,
  DEPLOYMENT_CAPACITY_STATUS,
  DISCOVERY_MODE,
  FINGERPRINT_PROOF_LEVEL,
} from "./deployment-vocabulary.js"
import { EXPECTED_OVERLAY_PLAN_SHA256 } from "./managed-overlay-catalog.js"
import {
  REQUIRED_EXCLUDED_LIVE_CLAIMS,
  RUNTIME_SCOPE_KIND,
  RUNTIME_SCOPE_POOL,
  RUNTIME_SCOPE_SOURCE_PATH,
  RUNTIME_SCOPE_WORKER,
} from "./runtime-scope-vocabulary.js"

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)

function sourceContractSchema<Path extends string>(path: Path) {
  return z.object({ path: z.literal(path), sha256: Sha256Schema }).strict()
}

const StaticEndpointsSchema = z.tuple([
  z.literal(MANAGED_DEPLOYMENT_CONFIG.staticWorkerEndpoints[0]),
  z.literal(MANAGED_DEPLOYMENT_CONFIG.staticWorkerEndpoints[1]),
])

const BlueWorkerPoolSchema = z
  .object({
    slot: z.literal(COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
    poolId: z.literal(RUNTIME_SCOPE_POOL.BLUE),
    scopedWorkerIds: z.tuple([
      z.literal(RUNTIME_SCOPE_WORKER.BLUE_00),
      z.literal(RUNTIME_SCOPE_WORKER.BLUE_01),
    ]),
    staticWorkerEndpoints: StaticEndpointsSchema,
  })
  .strict()

const GreenWorkerPoolSchema = z
  .object({
    slot: z.literal(COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN),
    poolId: z.literal(RUNTIME_SCOPE_POOL.GREEN),
    scopedWorkerIds: z.tuple([
      z.literal(RUNTIME_SCOPE_WORKER.GREEN_00),
      z.literal(RUNTIME_SCOPE_WORKER.GREEN_01),
    ]),
    staticWorkerEndpoints: StaticEndpointsSchema,
  })
  .strict()

const RuntimeScopeCertificateBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(RUNTIME_SCOPE_KIND.CERTIFICATE),
    overlayPlanSha256: z.literal(EXPECTED_OVERLAY_PLAN_SHA256),
    capacityStatus: z.literal(DEPLOYMENT_CAPACITY_STATUS.UNVERIFIED_UNTIL_TASK_41),
    proofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND),
    discoveryMode: z.literal(DISCOVERY_MODE.STATIC_CONFIG),
    workerPools: z.tuple([BlueWorkerPoolSchema, GreenWorkerPoolSchema]),
    sourceContracts: z
      .object({
        overlayDescriptor: sourceContractSchema(RUNTIME_SCOPE_SOURCE_PATH.OVERLAY_DESCRIPTOR),
        upstreamLock: sourceContractSchema(RUNTIME_SCOPE_SOURCE_PATH.UPSTREAM_LOCK),
        protocolCorpus: sourceContractSchema(RUNTIME_SCOPE_SOURCE_PATH.PROTOCOL_CORPUS),
        sessionIdVerdict: sourceContractSchema(RUNTIME_SCOPE_SOURCE_PATH.SESSION_ID_VERDICT),
        license: sourceContractSchema(RUNTIME_SCOPE_SOURCE_PATH.LICENSE),
        browserInput: sourceContractSchema(RUNTIME_SCOPE_SOURCE_PATH.BROWSER_INPUT),
      })
      .strict(),
    excludedLiveClaims: z.tuple([
      z.literal(REQUIRED_EXCLUDED_LIVE_CLAIMS[0]),
      z.literal(REQUIRED_EXCLUDED_LIVE_CLAIMS[1]),
      z.literal(REQUIRED_EXCLUDED_LIVE_CLAIMS[2]),
      z.literal(REQUIRED_EXCLUDED_LIVE_CLAIMS[3]),
      z.literal(REQUIRED_EXCLUDED_LIVE_CLAIMS[4]),
    ]),
  })
  .strict()

export const RuntimeScopeCertificateSchema = withDeepFrozenOutput(
  RuntimeScopeCertificateBaseSchema,
)

export type RuntimeScopeCertificate = z.infer<typeof RuntimeScopeCertificateSchema>
