import { z } from "zod"

import {
  COMPOSITE_ROUTE_PHASE,
  COOLIFY_PRODUCTION_OWNER,
  EDGE_ROUTE_MODE,
  STEEL_SERVING_TARGET,
  type CompositeRoutePhase,
  type CoolifyProductionOwner,
  type EdgeRouteMode,
  type SteelServingTarget,
} from "./deployment-vocabulary.js"
import {
  CompositeRoutePhaseSchema,
  CoolifyProductionOwnerSchema,
  EdgeRouteModeSchema,
  SteelServingTargetSchema,
} from "./deployment-vocabulary-schemas.js"

type RouteObservation = Readonly<{
  readonly edgeRouteMode: EdgeRouteMode
  readonly phase: CompositeRoutePhase
  readonly productionOwner: CoolifyProductionOwner
  readonly ownerObservationCount: number
}>

type RouteResolution =
  | Readonly<{ readonly resolved: true; readonly servingTarget: SteelServingTarget }>
  | Readonly<{ readonly resolved: false }>

const UNRESOLVED_ROUTE: RouteResolution = { resolved: false }

function proxyTarget(owner: CoolifyProductionOwner): RouteResolution {
  switch (owner) {
    case COOLIFY_PRODUCTION_OWNER.LEGACY:
      return { resolved: true, servingTarget: STEEL_SERVING_TARGET.LEGACY }
    case COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE:
      return { resolved: true, servingTarget: STEEL_SERVING_TARGET.MANAGED_BLUE }
    case COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN:
      return { resolved: true, servingTarget: STEEL_SERVING_TARGET.MANAGED_GREEN }
    case COOLIFY_PRODUCTION_OWNER.NONE:
      return UNRESOLVED_ROUTE
    default:
      return assertNever(owner)
  }
}

function maintenanceOwnerIsValid(route: RouteObservation): boolean {
  switch (route.phase) {
    case COMPOSITE_ROUTE_PHASE.MAINTENANCE_NO_OWNER:
      return (
        route.productionOwner === COOLIFY_PRODUCTION_OWNER.NONE &&
        route.ownerObservationCount === 0
      )
    case COMPOSITE_ROUTE_PHASE.MAINTENANCE_OLD_OWNER:
    case COMPOSITE_ROUTE_PHASE.MAINTENANCE_NEW_OWNER:
      return (
        route.productionOwner !== COOLIFY_PRODUCTION_OWNER.NONE &&
        route.ownerObservationCount === 1
      )
    case COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER:
      return false
    default:
      return assertNever(route.phase)
  }
}

function resolveRoute(route: RouteObservation): RouteResolution {
  if (route.ownerObservationCount > 1) return UNRESOLVED_ROUTE
  switch (route.edgeRouteMode) {
    case EDGE_ROUTE_MODE.COOLIFY_PROXY:
      if (
        route.phase !== COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER ||
        route.ownerObservationCount !== 1
      ) {
        return UNRESOLVED_ROUTE
      }
      return proxyTarget(route.productionOwner)
    case EDGE_ROUTE_MODE.MAINTENANCE:
      return maintenanceOwnerIsValid(route)
        ? { resolved: true, servingTarget: STEEL_SERVING_TARGET.MAINTENANCE }
        : UNRESOLVED_ROUTE
    default:
      return assertNever(route.edgeRouteMode)
  }
}

const CompositeRouteObservationFields = {
  edgeRouteMode: EdgeRouteModeSchema,
  phase: CompositeRoutePhaseSchema,
  productionOwner: CoolifyProductionOwnerSchema,
  ownerObservationCount: z.number().int().min(0).max(2),
} as const

export const CompositeRouteObservationSchema = z
  .object(CompositeRouteObservationFields)
  .strict()
  .superRefine((route, context) => {
    if (!resolveRoute(route).resolved) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "illegal route phase and owner observation" })
    }
  })

export const CompositeRouteTupleSchema = z
  .object({ ...CompositeRouteObservationFields, servingTarget: SteelServingTargetSchema })
  .strict()
  .superRefine((route, context) => {
    const resolution = resolveRoute(route)
    if (!resolution.resolved || route.servingTarget !== resolution.servingTarget) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "illegal route phase, owner, and target tuple" })
    }
  })

export class InvalidCompositeRouteError extends Error {
  override readonly name = "InvalidCompositeRouteError"
}

export function resolveSteelServingTarget(input: unknown): SteelServingTarget {
  const parsed = CompositeRouteObservationSchema.safeParse(input)
  if (!parsed.success) throw new InvalidCompositeRouteError("invalid composite route observation")
  const resolution = resolveRoute(parsed.data)
  if (!resolution.resolved) throw new InvalidCompositeRouteError("composite route did not resolve")
  return resolution.servingTarget
}

function assertNever(value: never): never {
  throw new InvalidCompositeRouteError(`unreachable route member: ${String(value)}`)
}
