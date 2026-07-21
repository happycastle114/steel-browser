import { z } from "zod"

import {
  AdmissionIdSchema,
  CreateIdempotencyKeySchema,
  OpaqueCursorSchema,
  SessionIdSchema,
} from "./control-plane-primitives.js"
import { SessionStateSchema } from "./control-plane-vocabulary-schemas.js"

export const SCREENSHOT_FORMAT = { PNG: "png", JPEG: "jpeg" } as const
export const SCRAPE_FORMAT = { TEXT: "text", MARKDOWN: "markdown" } as const
export const BROWSER_KEY = {
  ENTER: "ENTER",
  TAB: "TAB",
  ESCAPE: "ESCAPE",
  ARROW_UP: "ARROW_UP",
  ARROW_DOWN: "ARROW_DOWN",
  ARROW_LEFT: "ARROW_LEFT",
  ARROW_RIGHT: "ARROW_RIGHT",
  BACKSPACE: "BACKSPACE",
  DELETE: "DELETE",
  SPACE: "SPACE",
} as const

const NavigationUrlSchema = z.string().url().max(2_048).refine((value) => {
  const url = new URL(value)
  return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === ""
})

export const SessionCreateToolInputSchema = z.object({ idempotencyKey: CreateIdempotencyKeySchema }).strict()
export const SessionListToolInputSchema = z.object({
  state: z.array(SessionStateSchema).min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  cursor: OpaqueCursorSchema.optional(),
}).strict()
export const SessionGetToolInputSchema = z.object({ sessionId: SessionIdSchema }).strict()
export const SessionReleaseToolInputSchema = SessionGetToolInputSchema
export const AdmissionStatusToolInputSchema = z.object({ admissionId: AdmissionIdSchema }).strict()
export const AdmissionCancelToolInputSchema = AdmissionStatusToolInputSchema
export const NavigateToolInputSchema = z.object({ sessionId: SessionIdSchema, url: NavigationUrlSchema }).strict()
export const SnapshotToolInputSchema = SessionGetToolInputSchema
export const ScreenshotToolInputSchema = z.object({
  sessionId: SessionIdSchema,
  format: z.nativeEnum(SCREENSHOT_FORMAT).optional(),
  fullPage: z.boolean().optional(),
}).strict()
export const ScrapeToolInputSchema = z.object({ sessionId: SessionIdSchema, format: z.nativeEnum(SCRAPE_FORMAT) }).strict()
export const ClickToolInputSchema = z.object({ sessionId: SessionIdSchema, selector: z.string().min(1).max(1_024) }).strict()
export const TypeToolInputSchema = z.object({
  sessionId: SessionIdSchema,
  selector: z.string().min(1).max(1_024),
  text: z.string().max(65_536),
  clear: z.boolean().optional(),
}).strict()
export const KeyToolInputSchema = z.object({ sessionId: SessionIdSchema, key: z.nativeEnum(BROWSER_KEY) }).strict()
export const LiveViewToolInputSchema = SessionGetToolInputSchema
