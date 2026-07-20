import { z } from "zod"

import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"
import { DISCOVERY_MODE } from "./deployment-vocabulary.js"

export { DISCOVERY_MODE }

export const MANAGED_STATIC_WORKER_ENDPOINTS = MANAGED_DEPLOYMENT_CONFIG.staticWorkerEndpoints

const ManagedStaticWorkerEndpointsBaseSchema = z
  .tuple([
    z.literal(MANAGED_STATIC_WORKER_ENDPOINTS[0]),
    z.literal(MANAGED_STATIC_WORKER_ENDPOINTS[1]),
  ])
  .readonly()

export const ManagedStaticWorkerEndpointsSchema = ManagedStaticWorkerEndpointsBaseSchema.superRefine(
  (endpoints, context) => {
    if (new Set(endpoints).size !== MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "managed static worker endpoints must be distinct",
      })
    }
  },
)

const ManagedWorkerDiscoveryConfigBaseSchema = z
  .object({
    discoveryMode: z.literal(DISCOVERY_MODE.STATIC_CONFIG),
    staticWorkerEndpoints: ManagedStaticWorkerEndpointsSchema,
  })
  .strict()
  .readonly()

export const ManagedWorkerDiscoveryConfigSchema = ManagedWorkerDiscoveryConfigBaseSchema

export type ManagedStaticWorkerEndpoints = z.infer<typeof ManagedStaticWorkerEndpointsSchema>
export type ManagedWorkerDiscoveryConfig = z.infer<typeof ManagedWorkerDiscoveryConfigSchema>
