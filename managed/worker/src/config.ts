import { z } from "zod"
import {
  PRIVATE_SUPERVISOR_ROUTE,
  WORKER_IDENTITY_HEADER,
} from "@happycastle/steel-managed-shared"

export const WORKER_BIND_ADDRESS = {
  host: "0.0.0.0",
  port: 3000,
} as const

export const WORKER_META_PATH = PRIVATE_SUPERVISOR_ROUTE.META
export const WORKER_ACTIVE_CREATES_PATH = PRIVATE_SUPERVISOR_ROUTE.CREATES_ACTIVE
export const WORKER_CREATE_LOOKUP_PREFIX = PRIVATE_SUPERVISOR_ROUTE.CREATES_TOKEN.replace(":token", "")
export const WORKER_ACTIVE_SESSION_TIMEOUT_MS = 2_000 as const

export const WORKER_HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const

export { WORKER_IDENTITY_HEADER }

export const WORKER_BOOT_STATUS = {
  BOOTSTRAPPING: "BOOTSTRAPPING",
  READY: "READY",
} as const

export const UPSTREAM_SESSION_STATUS = {
  FAILED: "failed",
  IDLE: "idle",
  LIVE: "live",
  RELEASED: "released",
} as const

export type UpstreamSessionStatus =
  (typeof UPSTREAM_SESSION_STATUS)[keyof typeof UPSTREAM_SESSION_STATUS]

export type WorkerBootStatus =
  (typeof WORKER_BOOT_STATUS)[keyof typeof WORKER_BOOT_STATUS]

export const WORKER_ID = {
  PRIMARY: "worker-00",
  SECONDARY: "worker-01",
} as const

const WorkerIdSchema = z
  .enum([WORKER_ID.PRIMARY, WORKER_ID.SECONDARY])
  .brand("WorkerId")

const WorkerEnvironmentSchema = z.object({
  HOST: z.literal(WORKER_BIND_ADDRESS.host).optional(),
  MANAGED_CREATE_TOKEN_KEY_FILE: z.never().optional(),
  MANAGED_WORKER_HOST: z.never().optional(),
  MANAGED_WORKER_ID: WorkerIdSchema,
  MANAGED_WORKER_PORT: z.never().optional(),
  PORT: z.literal(String(WORKER_BIND_ADDRESS.port)).optional(),
  STEEL_MANAGED_CREATE_TOKEN_KEY_HEX: z.never().optional(),
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
