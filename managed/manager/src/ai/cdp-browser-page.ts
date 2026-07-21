import { z } from "zod"
import { ManagedTransportError } from "@happycastle/steel-managed-gateway"
import {
  BROWSER_KEY,
  MANAGED_ERROR_CODE,
  SCREENSHOT_FORMAT,
  SCRAPE_FORMAT,
} from "@happycastle/steel-managed-shared"
import type { BrowserPagePort } from "./browser-automation-executor.js"
import type { CdpCommandPort } from "./cdp-connection.js"

const CDP_METHOD = {
  ACCESSIBILITY_TREE: "Accessibility.getFullAXTree",
  CAPTURE_SCREENSHOT: "Page.captureScreenshot",
  DISPATCH_KEY: "Input.dispatchKeyEvent",
  NAVIGATE: "Page.navigate",
  RUNTIME_EVALUATE: "Runtime.evaluate",
} as const

const KEY_EVENT_TYPE = { DOWN: "keyDown", UP: "keyUp" } as const
const RETURN_BY_VALUE = { awaitPromise: true, returnByValue: true } as const

const JAVASCRIPT = {
  NAVIGATION_RESULT: `new Promise((resolve) => {
    const finish = () => resolve({ title: document.title, url: location.href });
    if (document.readyState === "complete") finish();
    else addEventListener("load", finish, { once: true });
  })`,
  PAGE_TEXT: "document.body?.innerText ?? ''",
} as const

const EvaluateResponseSchema = z.object({
  result: z.object({ value: z.unknown().optional() }).passthrough(),
  exceptionDetails: z.unknown().optional(),
}).passthrough()
const NavigationResultSchema = z.object({ title: z.string().optional(), url: z.string().url() }).strict()
const TextValueSchema = z.string()
const ScreenshotResponseSchema = z.object({
  data: z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
}).passthrough()
const AxValueSchema = z.object({ value: z.unknown().optional() }).passthrough()
const AxTreeSchema = z.object({
  nodes: z.array(z.object({
    role: AxValueSchema.optional(),
    name: AxValueSchema.optional(),
    value: AxValueSchema.optional(),
  }).passthrough()),
}).passthrough()

export class CdpBrowserPage implements BrowserPagePort {
  public constructor(
    private readonly connection: CdpCommandPort,
    private readonly sessionId: string,
  ) {
    if (sessionId.length === 0) throw new RangeError("CDP target session is required")
  }

  public async navigate(url: string): Promise<Readonly<{ title?: string; url: string }>> {
    await this.command(CDP_METHOD.NAVIGATE, { url })
    const response = await this.evaluate(JAVASCRIPT.NAVIGATION_RESULT)
    const result = NavigationResultSchema.parse(response)
    return {
      url: result.url,
      ...(result.title === undefined ? {} : { title: result.title }),
    }
  }

  public async snapshot(): Promise<string> {
    const response = AxTreeSchema.parse(await this.command(CDP_METHOD.ACCESSIBILITY_TREE))
    return response.nodes
      .map((node) => [axText(node.role), axText(node.name), axText(node.value)]
        .filter((value) => value.length > 0).join(" "))
      .filter((value) => value.length > 0)
      .join("\n")
  }

  public async scrape(
    _format: (typeof SCRAPE_FORMAT)[keyof typeof SCRAPE_FORMAT],
  ): Promise<string> {
    return TextValueSchema.parse(await this.evaluate(JAVASCRIPT.PAGE_TEXT))
  }

  public async screenshot(
    format: (typeof SCREENSHOT_FORMAT)[keyof typeof SCREENSHOT_FORMAT],
    fullPage: boolean,
  ): Promise<Uint8Array> {
    const response = ScreenshotResponseSchema.parse(await this.command(
      CDP_METHOD.CAPTURE_SCREENSHOT,
      {
        captureBeyondViewport: fullPage,
        format,
        fromSurface: true,
      },
    ))
    return Uint8Array.from(Buffer.from(response.data, "base64"))
  }

  public async click(selector: string): Promise<void> {
    await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error("selector not found");
      element.click();
    })()`)
  }

  public async type(selector: string, text: string, clear: boolean): Promise<void> {
    await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        throw new Error("editable selector not found");
      }
      element.focus();
      element.value = ${clear ? "''" : "element.value"} + ${JSON.stringify(text)};
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()`)
  }

  public async key(key: (typeof BROWSER_KEY)[keyof typeof BROWSER_KEY]): Promise<void> {
    const value = browserKeyValue(key)
    await this.command(CDP_METHOD.DISPATCH_KEY, { key: value, type: KEY_EVENT_TYPE.DOWN })
    await this.command(CDP_METHOD.DISPATCH_KEY, { key: value, type: KEY_EVENT_TYPE.UP })
  }

  public async close(): Promise<void> {
    await this.connection.close()
  }

  private async command(method: string, params: Readonly<Record<string, unknown>> = {}) {
    return await this.connection.send(method, params, this.sessionId)
  }

  private async evaluate(expression: string): Promise<unknown> {
    const response = EvaluateResponseSchema.parse(await this.command(
      CDP_METHOD.RUNTIME_EVALUATE,
      { expression, ...RETURN_BY_VALUE },
    ))
    if (response.exceptionDetails !== undefined) throw cdpEvaluationFailure()
    return response.result.value
  }
}

function axText(value: z.infer<typeof AxValueSchema> | undefined): string {
  const primitive = value?.value
  return typeof primitive === "string" || typeof primitive === "number"
    ? String(primitive)
    : ""
}

function browserKeyValue(key: (typeof BROWSER_KEY)[keyof typeof BROWSER_KEY]): string {
  const values: Readonly<Record<(typeof BROWSER_KEY)[keyof typeof BROWSER_KEY], string>> = {
    [BROWSER_KEY.ENTER]: "Enter",
    [BROWSER_KEY.TAB]: "Tab",
    [BROWSER_KEY.ESCAPE]: "Escape",
    [BROWSER_KEY.ARROW_UP]: "ArrowUp",
    [BROWSER_KEY.ARROW_DOWN]: "ArrowDown",
    [BROWSER_KEY.ARROW_LEFT]: "ArrowLeft",
    [BROWSER_KEY.ARROW_RIGHT]: "ArrowRight",
    [BROWSER_KEY.BACKSPACE]: "Backspace",
    [BROWSER_KEY.DELETE]: "Delete",
    [BROWSER_KEY.SPACE]: " ",
  }
  return values[key]
}

function cdpEvaluationFailure(): ManagedTransportError {
  return new ManagedTransportError(
    MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
    "The browser rejected the requested action",
  )
}
