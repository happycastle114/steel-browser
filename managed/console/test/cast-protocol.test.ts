import { describe, expect, it } from "vitest"

import { pageCastUrl, parseCastMessage, tabDiscoveryUrl } from "../src/features/live/cast-protocol.js"

describe("cast protocol", () => {
  it("derives tab and page sockets from the validated public cast URL", () => {
    const base = "wss://steel.example.com/v1/sessions/session-id/cast"
    expect(tabDiscoveryUrl(base)).toBe(`${base}?tabInfo=true`)
    expect(pageCastUrl(base, "page / one")).toBe(`${base}?pageId=page+%2F+one`)
  })

  it("accepts bounded tab and JPEG frame messages", () => {
    expect(parseCastMessage(JSON.stringify({ firstTabId: "page-1", tabs: [{ favicon: null, id: "page-1", title: "Page", url: "https://example.com/" }], type: "tabList" }))).toMatchObject({ firstTabId: "page-1", type: "tabList" })
    expect(parseCastMessage(JSON.stringify({ data: "jpeg", favicon: null, pageId: "page-1", title: "Page", url: "https://example.com/" }))).toMatchObject({ data: "jpeg", pageId: "page-1" })
  })

  it("drops malformed and oversized messages", () => {
    expect(parseCastMessage("not-json")).toBeUndefined()
    expect(parseCastMessage(JSON.stringify({ firstTabId: null, tabs: [], type: "unknown" }))).toBeUndefined()
    expect(parseCastMessage(JSON.stringify({ data: "x".repeat(16_000_001), favicon: null, pageId: "page-1", title: "Page", url: "https://example.com/" }))).toBeUndefined()
  })
})
