import { BROWSER_KEY, SCREENSHOT_FORMAT, SCRAPE_FORMAT } from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { CdpBrowserPage } from "../src/ai/cdp-browser-page.js"

describe("CDP browser page", () => {
  it("maps browser operations onto the attached target session", async () => {
    const calls: Array<Readonly<{ method: string; params: Readonly<Record<string, unknown>>; sessionId?: string }>> = []
    const page = new CdpBrowserPage({
      close: async () => undefined,
      send: async (method, params = {}, sessionId) => {
        calls.push({ method, params, ...(sessionId === undefined ? {} : { sessionId }) })
        if (method === "Runtime.evaluate" && calls.length === 2) {
          return { result: { value: { title: "fixture", url: "https://example.com/" } } }
        }
        if (method === "Runtime.evaluate") return { result: { value: "page text" } }
        if (method === "Accessibility.getFullAXTree") {
          return { nodes: [{ role: { value: "heading" }, name: { value: "Fixture" } }] }
        }
        if (method === "Page.captureScreenshot") return { data: "AQIDBA==" }
        return {}
      },
    }, "target-session")

    await expect(page.navigate("https://example.com/")).resolves.toEqual({
      title: "fixture",
      url: "https://example.com/",
    })
    await expect(page.snapshot()).resolves.toBe("heading Fixture")
    await expect(page.scrape(SCRAPE_FORMAT.TEXT)).resolves.toBe("page text")
    await expect(page.screenshot(SCREENSHOT_FORMAT.PNG, true))
      .resolves.toEqual(Uint8Array.from([1, 2, 3, 4]))
    await page.click("#submit")
    await page.type("#name", "Ada", true)
    await page.key(BROWSER_KEY.ENTER)
    await page.close()

    expect(calls.every(({ sessionId }) => sessionId === "target-session")).toBe(true)
    expect(calls.map(({ method }) => method)).toContain("Input.dispatchKeyEvent")
  })
})
