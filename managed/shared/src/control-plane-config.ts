import { z } from "zod"

import { PoolIdSchema } from "./control-plane-primitives.js"
import { MANAGER_MODE } from "./control-plane-vocabulary.js"
import { PublicOriginSchema, type PublicOrigin } from "./public-urls.js"
import {
  CONFIGURABLE_NUMERIC_BOUNDS,
  CONTROL_PLANE_DEFAULTS,
  CONTROL_PLANE_FIXED,
} from "./control-plane-config-values.js"
import {
  MANAGER_MEMORY_RATIOS,
  deriveManagerMemoryBudget as deriveValidatedBudget,
  deriveParsedManagerMemoryBudget,
  type ManagerMemoryBudget,
} from "./manager-memory-budget.js"

export { CONFIGURABLE_NUMERIC_BOUNDS, CONTROL_PLANE_DEFAULTS, CONTROL_PLANE_FIXED, MANAGER_MEMORY_RATIOS }

const bounded = (key: keyof typeof CONFIGURABLE_NUMERIC_BOUNDS, fallback: number) => {
  const bounds = CONFIGURABLE_NUMERIC_BOUNDS[key]
  return z.number().min(bounds.minimum).max(bounds.maximum).default(fallback)
}

const HostnameSchema = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u)
const OperatorUserEmailSchema = z.string().email().max(254).transform((value) => value.toLowerCase())

const ControlPlaneConfigInputSchema = z.object({
  maxConcurrentManagedProjects: z.literal(CONTROL_PLANE_FIXED.maxConcurrentManagedProjects).default(CONTROL_PLANE_FIXED.maxConcurrentManagedProjects),
  activeManagerCount: z.literal(CONTROL_PLANE_FIXED.activeManagerCount).default(CONTROL_PLANE_FIXED.activeManagerCount),
  activeWorkerCount: z.literal(CONTROL_PLANE_FIXED.activeWorkerCount).default(CONTROL_PLANE_FIXED.activeWorkerCount),
  coldStandbyProjectCount: z.literal(CONTROL_PLANE_FIXED.coldStandbyProjectCount).default(CONTROL_PLANE_FIXED.coldStandbyProjectCount),
  managerMemoryMiB: bounded("managerMemoryMiB", CONTROL_PLANE_DEFAULTS.managerMemoryMiB).pipe(z.number().int()),
  managerCpuLimit: bounded("managerCpuLimit", CONTROL_PLANE_DEFAULTS.managerCpuLimit),
  managerBaseP95Bytes: z.number().int().positive().safe(),
  workerMemoryMiB: bounded("workerMemoryMiB", CONTROL_PLANE_DEFAULTS.workerMemoryMiB).pipe(z.number().int()),
  workerMemoryReservationMiB: bounded("workerMemoryReservationMiB", CONTROL_PLANE_DEFAULTS.workerMemoryReservationMiB).pipe(z.number().int()),
  workerCpuLimit: bounded("workerCpuLimit", CONTROL_PLANE_DEFAULTS.workerCpuLimit),
  workerShmMiB: bounded("workerShmMiB", CONTROL_PLANE_DEFAULTS.workerShmMiB).pipe(z.number().int()),
  queueMax: bounded("queueMax", CONTROL_PLANE_DEFAULTS.queueMax).pipe(z.number().int()),
  ticketTtlMs: bounded("ticketTtlMs", CONTROL_PLANE_DEFAULTS.ticketTtlMs).pipe(z.number().int()),
  idempotencyTtlMs: bounded("idempotencyTtlMs", CONTROL_PLANE_DEFAULTS.idempotencyTtlMs).pipe(z.number().int()),
  listSnapshotMax: bounded("listSnapshotMax", CONTROL_PLANE_DEFAULTS.listSnapshotMax).pipe(z.number().int()),
  listSnapshotTtlMs: bounded("listSnapshotTtlMs", CONTROL_PLANE_DEFAULTS.listSnapshotTtlMs).pipe(z.number().int()),
  reconcileMs: bounded("reconcileMs", CONTROL_PLANE_DEFAULTS.reconcileMs).pipe(z.number().int()),
  probeTimeoutMs: bounded("probeTimeoutMs", CONTROL_PLANE_DEFAULTS.probeTimeoutMs).pipe(z.number().int()),
  createTimeoutMs: bounded("createTimeoutMs", CONTROL_PLANE_DEFAULTS.createTimeoutMs).pipe(z.number().int()),
  releaseTimeoutMs: bounded("releaseTimeoutMs", CONTROL_PLANE_DEFAULTS.releaseTimeoutMs).pipe(z.number().int()),
  actionTimeoutMs: bounded("actionTimeoutMs", CONTROL_PLANE_DEFAULTS.actionTimeoutMs).pipe(z.number().int()),
  drainTimeoutMs: bounded("drainTimeoutMs", CONTROL_PLANE_DEFAULTS.drainTimeoutMs).pipe(z.number().int()),
  httpBodyBytes: bounded("httpBodyBytes", CONTROL_PLANE_DEFAULTS.httpBodyBytes).pipe(z.number().int()),
  aiTextBytes: bounded("aiTextBytes", CONTROL_PLANE_DEFAULTS.aiTextBytes).pipe(z.number().int()),
  aiBinaryBytes: bounded("aiBinaryBytes", CONTROL_PLANE_DEFAULTS.aiBinaryBytes).pipe(z.number().int()),
  aiResultTtlMs: bounded("aiResultTtlMs", CONTROL_PLANE_DEFAULTS.aiResultTtlMs).pipe(z.number().int()),
  aiResultMax: bounded("aiResultMax", CONTROL_PLANE_DEFAULTS.aiResultMax).pipe(z.number().int()),
  webSocketMessageBytes: bounded("webSocketMessageBytes", CONTROL_PLANE_DEFAULTS.webSocketMessageBytes).pipe(z.number().int()),
  webSocketBufferBytes: bounded("webSocketBufferBytes", CONTROL_PLANE_DEFAULTS.webSocketBufferBytes).pipe(z.number().int()),
  webSocketIdleMs: bounded("webSocketIdleMs", CONTROL_PLANE_DEFAULTS.webSocketIdleMs).pipe(z.number().int()),
  rateGeneralPerMinute: bounded("rateGeneralPerMinute", CONTROL_PLANE_DEFAULTS.rateGeneralPerMinute).pipe(z.number().int()),
  rateCreatePerMinute: bounded("rateCreatePerMinute", CONTROL_PLANE_DEFAULTS.rateCreatePerMinute).pipe(z.number().int()),
  rateSubjectMax: bounded("rateSubjectMax", CONTROL_PLANE_DEFAULTS.rateSubjectMax).pipe(z.number().int()),
  terminalSessionMax: bounded("terminalSessionMax", CONTROL_PLANE_DEFAULTS.terminalSessionMax).pipe(z.number().int()),
  terminalSessionTtlMs: bounded("terminalSessionTtlMs", CONTROL_PLANE_DEFAULTS.terminalSessionTtlMs).pipe(z.number().int()),
  accessMaxTokenTtlSeconds: bounded("accessMaxTokenTtlSeconds", CONTROL_PLANE_DEFAULTS.accessMaxTokenTtlSeconds).pipe(z.number().int()),
  accessIssuer: z.string().url().refine((value) => new URL(value).protocol === "https:" && new URL(value).hostname.endsWith(".cloudflareaccess.com")),
  accessAudience: z.string().min(1),
  additionalAccessAudiences: z.array(z.string().min(1)).max(15).default([]),
  allowedHosts: z.array(HostnameSchema).min(1).max(16),
  publicOriginByHost: z.record(PublicOriginSchema),
  operatorServicePrincipals: z.array(z.string().min(1).max(256)).min(1).max(16),
  operatorUserEmails: z.array(OperatorUserEmailSchema).max(16).default([]),
  poolId: PoolIdSchema,
}).strict().superRefine((input, context) => {
  const hostSet = new Set(input.allowedHosts)
  const originHosts = Object.keys(input.publicOriginByHost)
  if (hostSet.size !== input.allowedHosts.length || originHosts.length !== hostSet.size || originHosts.some((host) => !hostSet.has(host))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "allowed Hosts and public origin keys must match" })
  }
  for (const [host, origin] of Object.entries(input.publicOriginByHost)) {
    if (new URL(origin).hostname !== host) context.addIssue({ code: z.ZodIssueCode.custom, message: "public origin Host must match map key" })
  }
  if (new Set(input.operatorServicePrincipals).size !== input.operatorServicePrincipals.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "operator service principals must be unique" })
  }
  if (new Set(input.operatorUserEmails).size !== input.operatorUserEmails.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "operator user emails must be unique" })
  }
  const accessAudiences = [input.accessAudience, ...input.additionalAccessAudiences]
  if (new Set(accessAudiences).size !== accessAudiences.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Access audiences must be unique" })
  }
  if (input.workerMemoryReservationMiB > input.workerMemoryMiB) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "worker memory reservation exceeds limit" })
  }
  if (input.aiTextBytes > input.httpBodyBytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "text presentation bound exceeds source bound" })
  }
})

export type ControlPlaneConfigInput = z.input<typeof ControlPlaneConfigInputSchema>
export type ControlPlaneConfig = Readonly<z.output<typeof ControlPlaneConfigInputSchema> & {
  readonly topology: Readonly<{
    readonly maxConcurrentManagedProjects: typeof CONTROL_PLANE_FIXED.maxConcurrentManagedProjects
    readonly activeManagerCount: typeof CONTROL_PLANE_FIXED.activeManagerCount
    readonly activeWorkerCount: typeof CONTROL_PLANE_FIXED.activeWorkerCount
    readonly coldStandbyProjectCount: typeof CONTROL_PLANE_FIXED.coldStandbyProjectCount
  }>
  readonly bootMode: typeof MANAGER_MODE.DRAINING
  readonly memory: ManagerMemoryBudget
  readonly allowedOrigins: readonly PublicOrigin[]
  readonly httpRequestTimeoutMs: number
  readonly uiStaleMs: number
  readonly emergencyFenceMs: number
  readonly legacyQuiescenceMs: number
}>

export function deriveManagerMemoryBudget(managerMemoryMiB: number): ManagerMemoryBudget {
  return deriveValidatedBudget({
    managerMemoryMiB,
    httpHeaderBytes: CONTROL_PLANE_FIXED.httpHeaderBytes,
    httpBodyBytes: CONTROL_PLANE_DEFAULTS.httpBodyBytes,
    aiBinaryBytes: CONTROL_PLANE_DEFAULTS.aiBinaryBytes,
    aiResultMax: CONTROL_PLANE_DEFAULTS.aiResultMax,
    webSocketMessageBytes: CONTROL_PLANE_DEFAULTS.webSocketMessageBytes,
    webSocketBufferBytes: CONTROL_PLANE_DEFAULTS.webSocketBufferBytes,
  })
}

export function parseControlPlaneConfig(input: unknown): ControlPlaneConfig {
  const parsed = ControlPlaneConfigInputSchema.parse(input)
  const memory = deriveParsedManagerMemoryBudget({
    managerMemoryMiB: parsed.managerMemoryMiB,
    httpHeaderBytes: CONTROL_PLANE_FIXED.httpHeaderBytes,
    httpBodyBytes: parsed.httpBodyBytes,
    aiBinaryBytes: parsed.aiBinaryBytes,
    aiResultMax: parsed.aiResultMax,
    webSocketMessageBytes: parsed.webSocketMessageBytes,
    webSocketBufferBytes: parsed.webSocketBufferBytes,
  })
  if (memory.ingressConnectionMax < 32 || memory.ingressBodyMax < 2 || memory.actionMax < 1 || memory.webSocketMax < 2) {
    throw new RangeError("derived manager concurrency is below its minimum")
  }
  const startupBytes = parsed.managerBaseP95Bytes + CONTROL_PLANE_FIXED.managerTmpfsLimitBytes + CONTROL_PLANE_FIXED.listSnapshotBytes + memory.dynamicLimitBytes
  if (startupBytes > Math.floor(MANAGER_MEMORY_RATIOS.startupMaximum * memory.managerLimitBytes)) {
    throw new RangeError("manager memory startup invariant exceeded")
  }
  return {
    ...parsed,
    topology: {
      maxConcurrentManagedProjects: CONTROL_PLANE_FIXED.maxConcurrentManagedProjects,
      activeManagerCount: CONTROL_PLANE_FIXED.activeManagerCount,
      activeWorkerCount: CONTROL_PLANE_FIXED.activeWorkerCount,
      coldStandbyProjectCount: CONTROL_PLANE_FIXED.coldStandbyProjectCount,
    },
    bootMode: CONTROL_PLANE_FIXED.bootMode,
    memory,
    allowedOrigins: Object.freeze(Object.values(parsed.publicOriginByHost)),
    httpRequestTimeoutMs: Math.max(parsed.actionTimeoutMs, parsed.createTimeoutMs) + CONTROL_PLANE_FIXED.httpResponseMarginMs,
    uiStaleMs: Math.max(15_000, 3 * parsed.reconcileMs),
    emergencyFenceMs: Math.max(parsed.idempotencyTtlMs, parsed.webSocketIdleMs, parsed.createTimeoutMs + parsed.releaseTimeoutMs),
    legacyQuiescenceMs: Math.max(parsed.createTimeoutMs, parsed.webSocketIdleMs, 3 * parsed.reconcileMs),
  }
}

export type AdmissionPolicy = Readonly<Pick<ControlPlaneConfig, "queueMax" | "ticketTtlMs" | "idempotencyTtlMs" | "reconcileMs"> & {
  readonly compatibilityWaitMs: typeof CONTROL_PLANE_FIXED.compatibilityWaitMs
  readonly ticketMax: typeof CONTROL_PLANE_FIXED.ticketMax
  readonly idempotencyMax: typeof CONTROL_PLANE_FIXED.idempotencyMax
}>
