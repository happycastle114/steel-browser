import {
  ActionIdSchema,
  BINARY_CONTENT_TYPE,
  CONTROL_PLANE_API_VERSION,
  SCREENSHOT_FORMAT,
  SESSION_STATE,
  SessionIdSchema,
  SessionSchema,
  TOOL_NAME,
  TOOL_VERSION,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { BrowserAutomationExecutor } from "../src/ai/browser-automation-executor.js"

const SESSION = SessionSchema.parse({
  createdAt: new Date(0).toISOString(),
  instanceId: "00000000-0000-4000-8000-000000000201",
  sessionId: SessionIdSchema.parse("00000000-0000-4000-8000-000000000101"),
  startedAt: new Date(0).toISOString(),
  state: SESSION_STATE.LIVE,
  workerId: "worker-00",
})

describe("browser automation executor", () => {
  it("materializes screenshot bytes and metadata from a fenced page session", async () => {
    let closed = false
    const bytes = Uint8Array.from([1, 2, 3, 4])
    const executor = new BrowserAutomationExecutor({
      actionIds: {
        next: () => ActionIdSchema.parse("00000000-0000-4000-8000-000000000301"),
      },
      clock: { now: () => 1_000 },
      openPage: async () => ({
        click: async () => undefined,
        close: async () => {
          closed = true
        },
        key: async () => undefined,
        navigate: async () => ({ title: "fixture", url: "https://example.com/" }),
        scrape: async () => "fixture",
        screenshot: async () => bytes,
        snapshot: async () => "fixture",
        type: async () => undefined,
      }),
      textBytes: 1_024,
    })
    const action = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      arguments: {
        format: SCREENSHOT_FORMAT.PNG,
        fullPage: true,
        sessionId: SESSION.sessionId,
      },
      tool: { name: TOOL_NAME.BROWSER_SCREENSHOT, version: TOOL_VERSION },
    } as const

    const result = await executor.execute(
      action,
      SESSION,
      new AbortController().signal,
    )

    expect(closed).toBe(true)
    expect(result.binaryBytes).toEqual(bytes)
    expect(result.output).toMatchObject({
      byteLength: bytes.byteLength,
      contentType: BINARY_CONTENT_TYPE.PNG,
      sessionId: SESSION.sessionId,
    })
  })
})
