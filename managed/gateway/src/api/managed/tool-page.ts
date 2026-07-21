import {
  CONTROL_PLANE_API_VERSION,
  MANAGED_ERROR_CODE,
  OpaqueCursorSchema,
  TOOL_NAMES,
  createAiToolPageContract,
  type AiToolPage,
  type AiToolPageConfig,
} from "@happycastle/steel-managed-shared"
import { z } from "zod"
import { ManagedTransportError } from "./transport-error.js"

const ToolPageQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(TOOL_NAMES.length).default(TOOL_NAMES.length),
  cursor: OpaqueCursorSchema.optional(),
}).strict().readonly()

const CURSOR_PREFIX = "tools_"

export async function createToolPage(
  queryInput: unknown,
  config: AiToolPageConfig,
): Promise<AiToolPage> {
  const query = ToolPageQuerySchema.safeParse(queryInput)
  if (!query.success) throw invalidCursor("Tool page query is invalid")
  const contract = await createAiToolPageContract(config)
  const descriptors = contract.schemaDescriptors
  const offset = query.data.cursor === undefined ? 0 : decodeCursor(query.data.cursor)
  if (offset >= descriptors.length && offset !== 0) throw invalidCursor("Tool cursor is outside the registry")
  const end = Math.min(descriptors.length, offset + query.data.pageSize)
  const hasMore = end < descriptors.length
  const parsed = contract.schema.parse({
    apiVersion: CONTROL_PLANE_API_VERSION,
    items: descriptors.slice(offset, end),
    page: {
      pageSize: query.data.pageSize,
      hasMore,
      ...(hasMore ? { nextCursor: encodeCursor(end) } : {}),
    },
  })
  return Object.freeze({
    apiVersion: parsed.apiVersion,
    items: parsed.items,
    page: parsed.page.nextCursor === undefined
      ? Object.freeze({ pageSize: parsed.page.pageSize, hasMore: parsed.page.hasMore })
      : Object.freeze({
        pageSize: parsed.page.pageSize,
        hasMore: parsed.page.hasMore,
        nextCursor: parsed.page.nextCursor,
      }),
  })
}

function encodeCursor(offset: number): string {
  return OpaqueCursorSchema.parse(`${CURSOR_PREFIX}${Buffer.from(String(offset), "utf8").toString("base64url")}`)
}

function decodeCursor(cursor: string): number {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw invalidCursor("Tool cursor is invalid")
  const decoded = Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8")
  if (!/^(?:0|[1-9][0-9]*)$/u.test(decoded)) throw invalidCursor("Tool cursor is invalid")
  return Number(decoded)
}

function invalidCursor(message: string): ManagedTransportError {
  return new ManagedTransportError(MANAGED_ERROR_CODE.INVALID_CURSOR, message)
}
