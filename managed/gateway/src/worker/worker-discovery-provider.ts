import { z } from "zod"
import {
  StaticWorkerEndpointsSchema,
  StaticWorkerProvider,
  type StaticWorkerConfig,
  type StaticWorkerEndpoint,
  type WorkerProvider,
} from "./static-worker-provider.js"

export const WORKER_DISCOVERY_MODE = {
  STATIC_CONFIG: "STATIC_CONFIG",
} as const
export type WorkerDiscoveryMode = (typeof WORKER_DISCOVERY_MODE)[keyof typeof WORKER_DISCOVERY_MODE]

const WorkerDiscoveryConfigBaseSchema = z
  .object({
    discoveryMode: z.literal(WORKER_DISCOVERY_MODE.STATIC_CONFIG),
    workers: StaticWorkerEndpointsSchema,
  })
  .strict()
  .readonly()

export const WorkerDiscoveryConfigSchema = WorkerDiscoveryConfigBaseSchema
export type WorkerDiscoveryConfig = z.infer<typeof WorkerDiscoveryConfigSchema>

export class WorkerDiscoveryConfigurationError extends Error {
  public override readonly name = "WorkerDiscoveryConfigurationError"

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export function createWorkerProvider(input: unknown): WorkerProvider {
  const parsed = WorkerDiscoveryConfigSchema.safeParse(input)
  if (!parsed.success) {
    throw new WorkerDiscoveryConfigurationError(
      "worker discovery must use STATIC_CONFIG with the fixed worker endpoints",
      { cause: parsed.error },
    )
  }
  try {
    return new StaticWorkerProvider({ workers: parsed.data.workers })
  } catch (error) {
    throw new WorkerDiscoveryConfigurationError(
      "STATIC_CONFIG endpoints must match the fixed private worker service origins",
      { cause: error instanceof Error ? error : undefined },
    )
  }
}

export type { StaticWorkerConfig, StaticWorkerEndpoint, WorkerProvider }
