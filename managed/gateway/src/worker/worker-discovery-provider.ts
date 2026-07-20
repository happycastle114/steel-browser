import {
  DISCOVERY_MODE,
  MANAGED_STATIC_WORKER_ENDPOINTS,
  ManagedWorkerDiscoveryConfigSchema,
  type DiscoveryMode,
  type ManagedWorkerDiscoveryConfig,
} from "@happycastle/steel-managed-shared"
import {
  StaticWorkerEndpointSchema,
  StaticWorkerProvider,
  type StaticWorkerConfig,
  type StaticWorkerEndpoint,
  type WorkerProvider,
} from "./static-worker-provider.js"

export { DISCOVERY_MODE, MANAGED_STATIC_WORKER_ENDPOINTS, ManagedWorkerDiscoveryConfigSchema }
export type WorkerDiscoveryMode = DiscoveryMode
export type WorkerDiscoveryConfig = ManagedWorkerDiscoveryConfig
export const WorkerDiscoveryConfigSchema = ManagedWorkerDiscoveryConfigSchema

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
    const workers = [
      parseCanonicalStaticEndpoint(parsed.data.staticWorkerEndpoints[0]),
      parseCanonicalStaticEndpoint(parsed.data.staticWorkerEndpoints[1]),
    ] as const
    return new StaticWorkerProvider({ workers })
  } catch (error) {
    throw new WorkerDiscoveryConfigurationError(
      "STATIC_CONFIG endpoints must match the fixed private worker service origins",
      { cause: error instanceof Error ? error : undefined },
    )
  }
}

function parseCanonicalStaticEndpoint(value: string): StaticWorkerEndpoint {
  const separator = value.indexOf("=")
  if (separator < 1) throw new Error("canonical static worker endpoint is malformed")
  return StaticWorkerEndpointSchema.parse({
    workerId: value.slice(0, separator),
    origin: value.slice(separator + 1),
  })
}

export type { StaticWorkerConfig, StaticWorkerEndpoint, WorkerProvider }
