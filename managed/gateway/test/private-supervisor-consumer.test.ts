import { describe, expect, it } from "vitest"
import {
  CreateTokenSchema,
  PRIVATE_SUPERVISOR_BODY_LIMIT,
  PRIVATE_SUPERVISOR_ROUTE_ID,
  PRIVATE_SUPERVISOR_ROUTE_REGISTRY,
  WORKER_IDENTITY_HEADER,
  buildPrivateSupervisorCreateLookupPath,
} from "@happycastle/steel-managed-shared"
import { requirePrivateSupervisorRoute } from "../src/index.js"

describe("canonical private-supervisor consumer", () => {
  it.each(PRIVATE_SUPERVISOR_ROUTE_REGISTRY)(
    "uses the shared $id route object without a local path copy",
    (route) => {
      expect(requirePrivateSupervisorRoute(route.id)).toBe(route)
    },
  )

  it("uses the shared query, token brand, identity headers, and route limits", () => {
    const active = requirePrivateSupervisorRoute(PRIVATE_SUPERVISOR_ROUTE_ID.CREATES_ACTIVE)
    const lookup = requirePrivateSupervisorRoute(PRIVATE_SUPERVISOR_ROUTE_ID.CREATES_TOKEN)
    const token = CreateTokenSchema.parse(`h1_${"a".repeat(64)}`)
    const lookupPath = buildPrivateSupervisorCreateLookupPath(token)

    expect(new URL(active.path, "http://worker.invalid").searchParams.size).toBe(1)
    expect(lookup.paramsSchema.parse({ token })).toEqual({ token })
    expect(lookupPath).toContain(token)
    expect(active.maxResponseBodyBytes).toBe(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_ACTIVE)
    expect(lookup.maxResponseBodyBytes).toBe(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_TOKEN)
    expect(new Set(Object.values(WORKER_IDENTITY_HEADER))).toHaveLength(2)
  })
})
