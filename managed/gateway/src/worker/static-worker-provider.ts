import { isIP } from "node:net"
import { z } from "zod"
import { WorkerIdSchema } from "../domain/ids.js"

export const STATIC_WORKER_COUNT = 2
const supportedSchemes = new Set(["http:"])
export const STATIC_WORKER_ENDPOINTS = Object.freeze([
  Object.freeze({ workerId: "worker-00", origin: "http://worker-00:3000" }),
  Object.freeze({ workerId: "worker-01", origin: "http://worker-01:3000" }),
] as const)

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number)
  const first = octets.at(0)
  const second = octets.at(1)
  if (first === 10 || first === 127) return true
  if (first === 192 && second === 168) return true
  return first === 172 && second !== undefined && second >= 16 && second <= 31
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true
  if (isIP(hostname) === 4) return isPrivateIpv4(hostname)
  if (isIP(hostname) === 6) return hostname === "::1"
  return /^worker-(00|01)$/.test(hostname)
}

export const WorkerOriginSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value)
    if (
      !supportedSchemes.has(url.protocol) ||
      !isPrivateHost(url.hostname) ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "worker origin must be private" })
    }
  })
  .transform((value) => new URL(value).origin)
  .brand("WorkerOrigin")
export type WorkerOrigin = z.infer<typeof WorkerOriginSchema>

export const StaticWorkerEndpointSchema = z.object({
  workerId: WorkerIdSchema,
  origin: WorkerOriginSchema,
}).strict().readonly()
export type StaticWorkerEndpoint = z.infer<typeof StaticWorkerEndpointSchema>

export const StaticWorkerConfigSchema = z
  .object({
    workers: z.tuple([StaticWorkerEndpointSchema, StaticWorkerEndpointSchema]).readonly(),
  })
  .strict()
  .superRefine(({ workers }, context) => {
    if (new Set(workers.map(({ workerId }) => workerId)).size !== STATIC_WORKER_COUNT) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "worker ids must be distinct" })
    }
    for (const [index, worker] of workers.entries()) {
      const expected = STATIC_WORKER_ENDPOINTS.find(
        ({ workerId }) => workerId === worker.workerId,
      )
      if (expected === undefined || worker.origin !== expected.origin) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "worker origin must match the fixed Coolify endpoint",
          path: ["workers", index, "origin"],
        })
      }
    }
  })
  .readonly()
export type StaticWorkerConfig = z.infer<typeof StaticWorkerConfigSchema>

export interface WorkerProvider {
  list(): readonly StaticWorkerEndpoint[]
}

export class StaticWorkerProvider implements WorkerProvider {
  private readonly workers: readonly StaticWorkerEndpoint[]

  public constructor(config: StaticWorkerConfig) {
    const parsed = StaticWorkerConfigSchema.parse(config)
    this.workers = Object.freeze(
      [...parsed.workers].sort((left, right) => left.workerId.localeCompare(right.workerId)),
    )
  }

  public list(): readonly StaticWorkerEndpoint[] {
    return this.workers
  }
}
