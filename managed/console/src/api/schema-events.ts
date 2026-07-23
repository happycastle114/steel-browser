import {
  EventListSchema,
  ManagedEventSchema,
} from "@happycastle/steel-managed-shared/browser"
import { z } from "zod"

export { EventType } from "../domain/vocabulary.js"
export { EventListSchema, ManagedEventSchema }

export type ManagedEvent = z.output<typeof ManagedEventSchema>
export type EventList = z.output<typeof EventListSchema>
