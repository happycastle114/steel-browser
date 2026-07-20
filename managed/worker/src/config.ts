import { z } from "zod"

export const WORKER_BIND_ADDRESS = {
  host: "0.0.0.0",
  port: 3000,
} as const

export const WORKER_META_PATH = "/v1/managed-worker/meta" as const

export const WORKER_BOOT_STATUS = {
  BOOTSTRAPPING: "BOOTSTRAPPING",
  READY: "READY",
} as const

export type WorkerBootStatus =
  (typeof WORKER_BOOT_STATUS)[keyof typeof WORKER_BOOT_STATUS]

const WorkerIdSchema = z
  .string()
  .regex(/^worker-(?:0[0-9]|[12][0-9]|3[01])$/)
  .brand("WorkerId")

const WorkerEnvironmentSchema = z.object({
  HOST: z.literal(WORKER_BIND_ADDRESS.host).optional(),
  MANAGED_WORKER_HOST: z.never().optional(),
  MANAGED_WORKER_ID: WorkerIdSchema,
  MANAGED_WORKER_PORT: z.never().optional(),
  PORT: z.literal(String(WORKER_BIND_ADDRESS.port)).optional(),
})

const NodeRuntimeVersionSchema = z.string().regex(/^22\.[0-9]+\.[0-9]+$/)

export type WorkerId = z.infer<typeof WorkerIdSchema>

export type WorkerConfig = {
  readonly workerId: WorkerId
}

export function assertNode22Runtime(version: string): void {
  NodeRuntimeVersionSchema.parse(version)
}

export function parseWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = WorkerEnvironmentSchema.parse(environment)
  return { workerId: parsed.MANAGED_WORKER_ID }
}
