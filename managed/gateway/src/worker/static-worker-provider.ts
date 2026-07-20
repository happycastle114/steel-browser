import { isIP } from "node:net"
import { z } from "zod"
import { MANAGED_STATIC_WORKER_ENDPOINTS } from "@happycastle/steel-managed-shared"
import { WorkerIdSchema } from "../domain/ids.js"

export const STATIC_WORKER_COUNT = MANAGED_STATIC_WORKER_ENDPOINTS.length
const supportedSchemes = new Set(["http:"])
const rootOriginPattern = /^[a-z][a-z0-9+.-]*:\/\/[^\/?#]+\/?$/iu

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number)
  const first = octets.at(0)
  const second = octets.at(1)
  if (first === 10 || first === 127) return true
  if (first === 192 && second === 168) return true
  if (first === 169 && second === 254) return true
  return first === 172 && second !== undefined && second >= 16 && second <= 31
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "::1") return true
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9")) return true
  if (normalized.startsWith("fea") || normalized.startsWith("feb")) return true
  return normalized.startsWith("fc") || normalized.startsWith("fd")
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "")
  if (hostname === "localhost") return true
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized)
  if (isIP(normalized) === 6) return isPrivateIpv6(normalized)
  return /^worker-(00|01)$/.test(normalized)
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
      !rootOriginPattern.test(value) ||
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

function parseCanonicalStaticEndpoint(value: string): StaticWorkerEndpoint {
  const separator = value.indexOf("=")
  if (separator < 1) throw new Error("canonical static worker endpoint is malformed")
  return StaticWorkerEndpointSchema.parse({
    workerId: value.slice(0, separator),
    origin: value.slice(separator + 1),
  })
}

export const StaticWorkerEndpointSchema = z.object({
  workerId: WorkerIdSchema,
  origin: WorkerOriginSchema,
}).strict().readonly()
export type StaticWorkerEndpoint = z.infer<typeof StaticWorkerEndpointSchema>

export const STATIC_WORKER_ENDPOINTS = Object.freeze(
  MANAGED_STATIC_WORKER_ENDPOINTS.map(parseCanonicalStaticEndpoint),
)

export const StaticWorkerEndpointsSchema = z
  .tuple([StaticWorkerEndpointSchema, StaticWorkerEndpointSchema])
  .readonly()

export const StaticWorkerConfigSchema = z
  .object({
    workers: StaticWorkerEndpointsSchema,
  })
  .strict()
  .superRefine(({ workers }, context) => {
    if (new Set(workers.map(({ workerId }) => workerId)).size !== STATIC_WORKER_COUNT) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "worker ids must be distinct" })
    }
    if (new Set(workers.map(({ origin }) => origin)).size !== STATIC_WORKER_COUNT) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "worker origins must be distinct" })
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
