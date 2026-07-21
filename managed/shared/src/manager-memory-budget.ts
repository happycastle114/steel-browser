import { z } from "zod"

import { CONFIGURABLE_NUMERIC_BOUNDS, CONTROL_PLANE_FIXED, MEBIBYTE_BYTES } from "./control-plane-config-values.js"

export const MANAGER_MEMORY_RATIOS = {
  dynamic: 0.4,
  result: 0.3,
  webSocket: 0.25,
  action: 0.25,
  ingressConnection: 0.25,
  startupMaximum: CONTROL_PLANE_FIXED.capacityUtilizationRatio,
} as const

export type ManagerMemoryBudget = Readonly<{
  readonly managerLimitBytes: number
  readonly dynamicLimitBytes: number
  readonly resultBudgetBytes: number
  readonly resultReservationBytes: number
  readonly resultCountLimit: number
  readonly webSocketBudgetBytes: number
  readonly actionBudgetBytes: number
  readonly ingressBudgetBytes: number
  readonly ingressConnectionBudgetBytes: number
  readonly ingressBodyBudgetBytes: number
  readonly httpConnectionReservationBytes: number
  readonly httpBodyReservationBytes: number
  readonly actionReservationBytes: number
  readonly webSocketReservationBytes: number
  readonly ingressConnectionMax: number
  readonly ingressBodyMax: number
  readonly actionMax: number
  readonly webSocketMax: number
}>

export type ManagerMemoryInputs = Readonly<{
  readonly managerMemoryMiB: number
  readonly httpHeaderBytes: number
  readonly httpBodyBytes: number
  readonly aiBinaryBytes: number
  readonly aiResultMax: number
  readonly webSocketMessageBytes: number
  readonly webSocketBufferBytes: number
}>

const ManagerMemoryInputsSchema = z.object({
  managerMemoryMiB: z.number().int().min(CONFIGURABLE_NUMERIC_BOUNDS.managerMemoryMiB.minimum).max(CONFIGURABLE_NUMERIC_BOUNDS.managerMemoryMiB.maximum),
  httpHeaderBytes: z.number().int().positive().safe(),
  httpBodyBytes: z.number().int().positive().safe(),
  aiBinaryBytes: z.number().int().positive().safe(),
  aiResultMax: z.number().int().min(CONFIGURABLE_NUMERIC_BOUNDS.aiResultMax.minimum).max(CONFIGURABLE_NUMERIC_BOUNDS.aiResultMax.maximum),
  webSocketMessageBytes: z.number().int().positive().safe(),
  webSocketBufferBytes: z.number().int().positive().safe(),
}).strict()

export function deriveManagerMemoryBudget(inputs: ManagerMemoryInputs): ManagerMemoryBudget {
  const parsed = ManagerMemoryInputsSchema.parse(inputs)
  return deriveParsedManagerMemoryBudget(parsed)
}

export function deriveParsedManagerMemoryBudget(parsed: z.output<typeof ManagerMemoryInputsSchema>): ManagerMemoryBudget {
  const managerLimitBytes = parsed.managerMemoryMiB * MEBIBYTE_BYTES
  const dynamicLimitBytes = Math.floor(MANAGER_MEMORY_RATIOS.dynamic * managerLimitBytes)
  const resultBudgetBytes = Math.floor(MANAGER_MEMORY_RATIOS.result * dynamicLimitBytes)
  const webSocketBudgetBytes = Math.floor(MANAGER_MEMORY_RATIOS.webSocket * dynamicLimitBytes)
  const actionBudgetBytes = Math.floor(MANAGER_MEMORY_RATIOS.action * dynamicLimitBytes)
  const ingressBudgetBytes = dynamicLimitBytes - resultBudgetBytes - webSocketBudgetBytes - actionBudgetBytes
  const ingressConnectionBudgetBytes = Math.floor(MANAGER_MEMORY_RATIOS.ingressConnection * ingressBudgetBytes)
  const ingressBodyBudgetBytes = ingressBudgetBytes - ingressConnectionBudgetBytes
  const httpConnectionReservationBytes = parsed.httpHeaderBytes + CONTROL_PLANE_FIXED.httpConnectionOverheadBytes
  const httpBodyReservationBytes = 4 * parsed.httpBodyBytes + CONTROL_PLANE_FIXED.httpBodyOverheadBytes
  const actionReservationBytes = 2 * parsed.aiBinaryBytes + parsed.httpBodyBytes + CONTROL_PLANE_FIXED.actionOverheadBytes
  const webSocketReservationBytes = parsed.webSocketMessageBytes + parsed.webSocketBufferBytes + CONTROL_PLANE_FIXED.webSocketOverheadBytes
  return {
    managerLimitBytes,
    dynamicLimitBytes,
    resultBudgetBytes,
    resultReservationBytes: parsed.aiBinaryBytes,
    resultCountLimit: parsed.aiResultMax,
    webSocketBudgetBytes,
    actionBudgetBytes,
    ingressBudgetBytes,
    ingressConnectionBudgetBytes,
    ingressBodyBudgetBytes,
    httpConnectionReservationBytes,
    httpBodyReservationBytes,
    actionReservationBytes,
    webSocketReservationBytes,
    ingressConnectionMax: Math.floor(ingressConnectionBudgetBytes / httpConnectionReservationBytes),
    ingressBodyMax: Math.floor(ingressBodyBudgetBytes / httpBodyReservationBytes),
    actionMax: Math.floor(actionBudgetBytes / actionReservationBytes),
    webSocketMax: Math.floor(webSocketBudgetBytes / webSocketReservationBytes),
  }
}
