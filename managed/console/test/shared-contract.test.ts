import {
  EventListSchema as SharedEventListSchema,
  ManagedEventSchema as SharedManagedEventSchema,
  PoolSchema as SharedPoolSchema,
  VersionSchema as SharedVersionSchema,
} from "@happycastle/steel-managed-shared/browser"
import { describe, expect, it } from "vitest"

import { EventListSchema, ManagedEventSchema } from "../src/api/schema-events.js"
import { PoolSchema } from "../src/api/schema-pool.js"
import {
  AdmissionListSchema,
  SessionListSchema,
  SessionSchema,
  VersionSchema,
  WorkerListSchema,
} from "../src/api/schema-resources.js"
import { fixtures } from "./visual/fixtures.js"

describe("console public contracts", () => {
  it("uses the browser-safe shared schemas by identity", () => {
    expect(VersionSchema).toBe(SharedVersionSchema)
    expect(PoolSchema).toBe(SharedPoolSchema)
    expect(ManagedEventSchema).toBe(SharedManagedEventSchema)
    expect(EventListSchema).toBe(SharedEventListSchema)
  })

  it("keeps the visual fixtures valid against the shared contracts", () => {
    expect(VersionSchema.safeParse(fixtures.version)).toMatchObject({ success: true })
    expect(PoolSchema.safeParse(fixtures.pool)).toMatchObject({ success: true })
    expect(EventListSchema.safeParse(fixtures.events)).toMatchObject({ success: true })
    expect(SessionSchema.safeParse(fixtures.liveSession)).toMatchObject({ success: true })
    expect(SessionListSchema.safeParse(fixtures.sessions)).toMatchObject({ success: true })
    expect(AdmissionListSchema.safeParse(fixtures.admissions)).toMatchObject({ success: true })
    expect(WorkerListSchema.safeParse(fixtures.workers)).toMatchObject({ success: true })
  })
})
