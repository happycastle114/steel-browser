import { z } from "zod"

import { canonicalJson } from "./canonical-json.js"
import {
  BootIdSchema,
  CanonicalCursorSequenceSchema,
  OpaqueCursorSchema,
  SafeCountSchema,
  Sha256Schema,
  SnapshotIdSchema,
  type CanonicalCursorSequence,
} from "./control-plane-primitives.js"

export const LIST_RESOURCE_KIND = { WORKERS: "workers", SESSIONS: "sessions", QUEUE: "queue" } as const
export type ListResourceKind = (typeof LIST_RESOURCE_KIND)[keyof typeof LIST_RESOURCE_KIND]

export const EventCursorPayloadSchema = z.object({
  v: z.literal(1),
  b: BootIdSchema,
  s: CanonicalCursorSequenceSchema,
}).strict()
export const ListCursorPayloadSchema = z.object({
  v: z.literal(1),
  b: BootIdSchema,
  k: z.nativeEnum(LIST_RESOURCE_KIND),
  f: Sha256Schema,
  n: SnapshotIdSchema,
  o: SafeCountSchema,
}).strict()

export type EventCursorPayload = z.infer<typeof EventCursorPayloadSchema>
export type ListCursorPayload = z.infer<typeof ListCursorPayloadSchema>

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

function decodeBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

function encodePayload(payload: unknown): z.infer<typeof OpaqueCursorSchema> {
  return OpaqueCursorSchema.parse(encodeBase64Url(canonicalJson(payload)))
}

function decodeCanonical<Output, Definition extends z.ZodTypeDef, Input>(
  cursorInput: string,
  schema: z.ZodType<Output, Definition, Input>,
): Output {
  const cursor = OpaqueCursorSchema.parse(cursorInput)
  const decoded = decodeBase64Url(cursor)
  const decodedValue: unknown = JSON.parse(decoded)
  const value = schema.parse(decodedValue)
  if (encodePayload(value) !== cursor) throw new TypeError("cursor is not canonical")
  return value
}

export const encodeEventCursor = (payload: EventCursorPayload): z.infer<typeof OpaqueCursorSchema> => encodePayload(EventCursorPayloadSchema.parse(payload))
export const decodeEventCursor = (cursor: string): EventCursorPayload => decodeCanonical(cursor, EventCursorPayloadSchema)
export const encodeListCursor = (payload: ListCursorPayload): z.infer<typeof OpaqueCursorSchema> => encodePayload(ListCursorPayloadSchema.parse(payload))
export const decodeListCursor = (cursor: string): ListCursorPayload => decodeCanonical(cursor, ListCursorPayloadSchema)
export const EMPTY_EVENT_SEQUENCE: CanonicalCursorSequence = CanonicalCursorSequenceSchema.parse("0")
