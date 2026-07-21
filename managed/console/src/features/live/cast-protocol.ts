import { z } from "zod"

const pageId = z.string().min(1).max(256)
const pageInfo = z.object({
  favicon: z.string().url().nullable(),
  id: pageId,
  title: z.string().max(4_096),
  url: z.string().max(8_192),
}).strict()

const controlMessage = z.discriminatedUnion("type", [
  z.object({ firstTabId: pageId.nullable(), tabs: z.array(pageInfo).max(32), type: z.literal("tabList") }).strict(),
  z.object({ pageId, type: z.literal("tabClosed") }).strict(),
  z.object({ pageId, type: z.literal("activeTabChange") }).strict(),
  z.object({ favicon: z.string().url().nullable(), title: z.string().max(4_096), type: z.literal("tabUpdate"), url: z.string().max(8_192) }).strict(),
  z.object({ pageId, type: z.literal("targetClosed") }).strict(),
])

const frameMessage = z.object({
  data: z.string().min(1).max(16_000_000),
  favicon: z.string().url().nullable(),
  pageId,
  title: z.string().max(4_096),
  url: z.string().max(8_192),
}).strict()

export type CastMessage = z.infer<typeof controlMessage> | z.infer<typeof frameMessage>
export type CastPage = z.infer<typeof pageInfo>

export function parseCastMessage(value: string): CastMessage | undefined {
  try {
    const json: unknown = JSON.parse(value)
    const control = controlMessage.safeParse(json)
    if (control.success) return control.data
    const frame = frameMessage.safeParse(json)
    return frame.success ? frame.data : undefined
  } catch {
    return undefined
  }
}

export function tabDiscoveryUrl(input: string): string {
  const url = new URL(input)
  url.searchParams.set("tabInfo", "true")
  return url.toString()
}

export function pageCastUrl(input: string, selectedPageId: string): string {
  const url = new URL(input)
  url.searchParams.set("pageId", selectedPageId)
  return url.toString()
}
