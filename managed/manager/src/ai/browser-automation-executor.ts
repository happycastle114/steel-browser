import { createHash } from "node:crypto"
import { TextDecoder } from "node:util"
import { ManagedTransportError } from "@happycastle/steel-managed-gateway"
import {
  BINARY_CONTENT_TYPE,
  BROWSER_KEY,
  ClickToolInputSchema,
  KeyToolInputSchema,
  MANAGED_ERROR_CODE,
  NavigateToolInputSchema,
  RESULT_KIND,
  SCREENSHOT_FORMAT,
  SCRAPE_FORMAT,
  ScrapeToolInputSchema,
  ScreenshotToolInputSchema,
  SessionGetToolInputSchema,
  Sha256Schema,
  TEXT_RESULT_FORMAT,
  TOOL_NAME,
  TypeToolInputSchema,
  type ActionId,
  type AiActionRequest,
  type Session,
} from "@happycastle/steel-managed-shared"
import type {
  BrowserAutomationPort,
  BrowserAutomationResult,
} from "./manager-ai-execution-port.js"

export interface BrowserPagePort {
  click(selector: string): Promise<void>
  close(): Promise<void>
  key(key: (typeof BROWSER_KEY)[keyof typeof BROWSER_KEY]): Promise<void>
  navigate(url: string): Promise<Readonly<{ title?: string; url: string }>>
  scrape(format: (typeof SCRAPE_FORMAT)[keyof typeof SCRAPE_FORMAT]): Promise<string>
  screenshot(
    format: (typeof SCREENSHOT_FORMAT)[keyof typeof SCREENSHOT_FORMAT],
    fullPage: boolean,
  ): Promise<Uint8Array>
  snapshot(): Promise<string>
  type(selector: string, text: string, clear: boolean): Promise<void>
}

type BrowserAutomationExecutorOptions = Readonly<{
  actionIds: Readonly<{ next(): ActionId }>
  clock: Readonly<{ now(): number }>
  openPage(session: Session, signal: AbortSignal): Promise<BrowserPagePort>
  textBytes: number
}>

export class BrowserAutomationExecutor implements BrowserAutomationPort {
  public constructor(private readonly options: BrowserAutomationExecutorOptions) {
    if (!Number.isSafeInteger(options.textBytes) || options.textBytes < 1) {
      throw new RangeError("browser text limit must be positive")
    }
  }

  public async execute(
    action: AiActionRequest,
    session: Session,
    signal: AbortSignal,
  ): Promise<BrowserAutomationResult> {
    if (signal.aborted) throw actionAborted()
    const page = await this.options.openPage(session, signal)
    try {
      switch (action.tool.name) {
        case TOOL_NAME.BROWSER_NAVIGATE: {
          const input = NavigateToolInputSchema.parse(action.arguments)
          const navigated = await page.navigate(input.url)
          return {
            output: {
              kind: RESULT_KIND.NAVIGATION,
              sessionId: session.sessionId,
              url: navigated.url,
              ...(navigated.title === undefined ? {} : { title: navigated.title }),
              completedAt: this.isoNow(),
            },
          }
        }
        case TOOL_NAME.BROWSER_SNAPSHOT:
          SessionGetToolInputSchema.parse(action.arguments)
          return { output: this.textResult(
            session.sessionId,
            TEXT_RESULT_FORMAT.ACCESSIBILITY,
            await page.snapshot(),
          ) }
        case TOOL_NAME.BROWSER_SCREENSHOT: {
          const input = ScreenshotToolInputSchema.parse(action.arguments)
          const format = input.format ?? SCREENSHOT_FORMAT.PNG
          const bytes = Uint8Array.from(await page.screenshot(format, input.fullPage ?? false))
          return {
            binaryBytes: bytes,
            output: {
              kind: RESULT_KIND.BINARY,
              sessionId: session.sessionId,
              contentType: format === SCREENSHOT_FORMAT.PNG
                ? BINARY_CONTENT_TYPE.PNG
                : BINARY_CONTENT_TYPE.JPEG,
              byteLength: bytes.byteLength,
              sha256: Sha256Schema.parse(createHash("sha256").update(bytes).digest("hex")),
            },
          }
        }
        case TOOL_NAME.BROWSER_SCRAPE: {
          const input = ScrapeToolInputSchema.parse(action.arguments)
          return { output: this.textResult(
            session.sessionId,
            input.format === SCRAPE_FORMAT.MARKDOWN
              ? TEXT_RESULT_FORMAT.MARKDOWN
              : TEXT_RESULT_FORMAT.TEXT,
            await page.scrape(input.format),
          ) }
        }
        case TOOL_NAME.BROWSER_CLICK: {
          const input = ClickToolInputSchema.parse(action.arguments)
          await page.click(input.selector)
          return { output: this.actionResult(session.sessionId) }
        }
        case TOOL_NAME.BROWSER_TYPE: {
          const input = TypeToolInputSchema.parse(action.arguments)
          await page.type(input.selector, input.text, input.clear ?? false)
          return { output: this.actionResult(session.sessionId) }
        }
        case TOOL_NAME.BROWSER_KEY: {
          const input = KeyToolInputSchema.parse(action.arguments)
          await page.key(input.key)
          return { output: this.actionResult(session.sessionId) }
        }
        case TOOL_NAME.SESSION_CREATE:
        case TOOL_NAME.SESSION_LIST:
        case TOOL_NAME.SESSION_GET:
        case TOOL_NAME.SESSION_RELEASE:
        case TOOL_NAME.ADMISSION_STATUS:
        case TOOL_NAME.ADMISSION_CANCEL:
        case TOOL_NAME.BROWSER_LIVE_VIEW:
          throw invalidBrowserAction()
      }
    } finally {
      await page.close()
    }
  }

  private actionResult(sessionId: Session["sessionId"]) {
    return {
      kind: RESULT_KIND.ACTION,
      sessionId,
      actionId: this.options.actionIds.next(),
      completedAt: this.isoNow(),
    }
  }

  private textResult(
    sessionId: Session["sessionId"],
    format: (typeof TEXT_RESULT_FORMAT)[keyof typeof TEXT_RESULT_FORMAT],
    source: string,
  ) {
    const bytes = Buffer.from(source, "utf8")
    const delivered = truncateUtf8(bytes, this.options.textBytes)
    return {
      kind: RESULT_KIND.TEXT,
      sessionId,
      format,
      text: delivered.toString("utf8"),
      truncated: delivered.byteLength < bytes.byteLength,
      byteLength: bytes.byteLength,
      deliveredByteLength: delivered.byteLength,
      sha256: Sha256Schema.parse(createHash("sha256").update(bytes).digest("hex")),
    }
  }

  private isoNow(): string {
    const now = this.options.clock.now()
    if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("browser clock rejected")
    return new Date(now).toISOString()
  }
}

function truncateUtf8(bytes: Buffer, maximum: number): Buffer {
  if (bytes.byteLength <= maximum) return bytes
  for (let length = maximum; length > 0; length -= 1) {
    const candidate = bytes.subarray(0, length)
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return Buffer.alloc(0)
}

function invalidBrowserAction(): ManagedTransportError {
  return new ManagedTransportError(
    MANAGED_ERROR_CODE.TOOL_INPUT_INVALID,
    "The browser action was invalid",
  )
}

function actionAborted(): ManagedTransportError {
  return new ManagedTransportError(MANAGED_ERROR_CODE.TOOL_TIMEOUT, "The browser action was aborted")
}
