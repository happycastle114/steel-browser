import { z } from "zod"

import { canonicalJson } from "./canonical-json.js"
import { ControlPlaneApiVersionSchema } from "./control-plane-contract.js"
import { OpaqueCursorSchema } from "./control-plane-primitives.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"
import {
  ToolDescriptorSchema,
  ToolSchemaDescriptorSchema,
  type ToolDescriptor,
  type ToolSchemaDescriptor,
} from "./tool-capability-schemas.js"
import { TOOL_NAMES } from "./tool-registry.js"

const TOOL_CURSOR_PREFIX = "tools_"

function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equalValue(value, right[index]))
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false
  const leftEntries = Object.entries(left)
  const rightEntries = new Map(Object.entries(right))
  return leftEntries.length === rightEntries.size && leftEntries.every(([key, value]) =>
    rightEntries.has(key) && equalValue(value, rightEntries.get(key)))
}

function encodeToolCursor(offset: number): string {
  const bytes = new TextEncoder().encode(String(offset))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `${TOOL_CURSOR_PREFIX}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`
}

function decodeToolCursor(cursor: string): number | undefined {
  if (!cursor.startsWith(TOOL_CURSOR_PREFIX)) return undefined
  const encoded = cursor.slice(TOOL_CURSOR_PREFIX.length)
  if (encoded.length === 0) return undefined
  try {
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    )
    if (!/^(?:0|[1-9][0-9]*)$/u.test(decoded)) return undefined
    const offset = Number(decoded)
    return Number.isSafeInteger(offset) && encodeToolCursor(offset) === cursor ? offset : undefined
  } catch {
    return undefined
  }
}

function requireExactToolNames(
  tools: readonly Readonly<{ readonly name: (typeof TOOL_NAMES)[number] }>[],
  context: z.RefinementCtx,
): void {
  for (const [index, expectedName] of TOOL_NAMES.entries()) {
    if (tools[index]?.name !== expectedName) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "tool descriptors must match the canonical registry" })
      return
    }
  }
}

const CanonicalDescriptorListSchema = z.array(ToolDescriptorSchema)
  .length(TOOL_NAMES.length)
  .superRefine(requireExactToolNames)
const CanonicalSchemaDescriptorListSchema = z.array(ToolSchemaDescriptorSchema)
  .length(TOOL_NAMES.length)
  .superRefine(requireExactToolNames)

const AiToolPageMetadataSchema = z.object({
  pageSize: z.number().int().min(1).max(TOOL_NAMES.length),
  hasMore: z.boolean(),
  nextCursor: OpaqueCursorSchema.optional(),
}).strict().superRefine((page, context) => {
  if (page.hasMore !== (page.nextCursor !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "next cursor presence must match hasMore" })
  }
})

const AiToolPageBaseSchema = z.object({
  apiVersion: ControlPlaneApiVersionSchema,
  items: z.array(ToolSchemaDescriptorSchema).max(TOOL_NAMES.length),
  page: AiToolPageMetadataSchema,
}).strict().superRefine((response, context) => {
  if (response.items.length > response.page.pageSize) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "tool items must fit the advertised page size" })
  }
  if (new Set(response.items.map((item) => item.name)).size !== response.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "tool names must be unique within a page" })
  }
})

type ToolPageItemMatcher = (item: ToolSchemaDescriptor, canonicalIndex: number) => boolean

function descriptorBoundPageSchema(expectedCount: number, matches: ToolPageItemMatcher) {
  return withDeepFrozenOutput(AiToolPageBaseSchema.superRefine((response, context) => {
    const end = response.page.hasMore
      ? response.page.nextCursor === undefined ? undefined : decodeToolCursor(response.page.nextCursor)
      : expectedCount
    if (end === undefined || end <= 0 || end > expectedCount) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "tool page cursor must identify a canonical end offset" })
      return
    }
    const start = end - response.items.length
    if (start < 0 || response.items.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "tool page items must identify a non-empty canonical window" })
      return
    }
    if (response.page.hasMore && end === expectedCount) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "terminal canonical offset must omit continuation" })
      return
    }
    if (response.page.hasMore && response.page.nextCursor !== encodeToolCursor(end)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "tool page cursor is not canonical" })
      return
    }
    for (const [index, item] of response.items.entries()) {
      if (!matches(item, start + index)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "tool page items must match the canonical registry window" })
        return
      }
    }
  }))
}

function matchesDescriptor(item: ToolSchemaDescriptor, expected: ToolDescriptor): boolean {
  return item.name === expected.name &&
    item.version === expected.version &&
    item.mutability === expected.mutability &&
    item.sessionRequirement === expected.sessionRequirement &&
    item.inputSchemaSha256 === expected.inputSchemaSha256 &&
    item.outputSchemaSha256 === expected.outputSchemaSha256
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function schemaDigestsMatch(input: unknown): Promise<boolean> {
  const item = ToolSchemaDescriptorSchema.parse(input)
  return item.inputSchemaSha256 === await sha256(item.inputSchema) &&
    item.outputSchemaSha256 === await sha256(item.outputSchema)
}

export function createAiToolPageSchemaForCatalog(canonicalDescriptors: readonly ToolSchemaDescriptor[]) {
  const expected = CanonicalSchemaDescriptorListSchema.parse(canonicalDescriptors)
  return descriptorBoundPageSchema(expected.length, (item, index) => {
    const descriptor = expected[index]
    return descriptor !== undefined && equalValue(item, descriptor)
  })
}

export async function parseAiToolPage(
  input: unknown,
  canonicalDescriptors: readonly ToolDescriptor[],
) {
  const expected = CanonicalDescriptorListSchema.parse(canonicalDescriptors)
  const parsed = descriptorBoundPageSchema(expected.length, (item, index) => {
    const descriptor = expected[index]
    return descriptor !== undefined && matchesDescriptor(item, descriptor)
  }).parse(input)
  for (const item of parsed.items) {
    if (!(await schemaDigestsMatch(item))) {
      throw new TypeError("tool page schema bytes do not match their advertised digests")
    }
  }
  return parsed
}

export type AiToolPage = Readonly<{
  readonly apiVersion: z.output<typeof ControlPlaneApiVersionSchema>
  readonly items: readonly ToolSchemaDescriptor[]
  readonly page: Readonly<{
    readonly pageSize: number
    readonly hasMore: boolean
    readonly nextCursor?: z.output<typeof OpaqueCursorSchema>
  }>
}>
