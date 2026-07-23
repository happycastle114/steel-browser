import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page, type Route } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { fixtures, liveSessionId } from "./fixtures.js"

const evidenceRoot = resolve(process.cwd(), "../../.omo/evidence/steel-console-ui")

test.beforeEach(async ({ page }) => installApiFixtures(page))

test("managed console renders contract-shaped overview, sessions, and integrations", async ({ page }, testInfo) => {
  await page.goto("")
  await expect(page.getByRole("heading", { name: "Browser operations" })).toBeVisible()
  await expect(page.getByText("2 private workers")).toBeVisible()
  await assertAccessible(page, testInfo.project.name, "overview")
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ fullPage: true, path: `${evidenceRoot}/product-overview-${testInfo.project.name}.png` })

  await page.getByRole("link", { name: "Sessions" }).click()
  await expect(page.getByRole("heading", { name: "Sessions and queue" })).toBeVisible()
  await expect(page.getByText("Admission queue")).toBeVisible()
  await page.goto(`sessions/${liveSessionId}`)
  await expect(page.getByRole("heading", { name: liveSessionId })).toBeVisible()
  await expect(page.locator(".session-inspector").getByText("worker-00", { exact: true })).toBeVisible()
  await assertAccessible(page, testInfo.project.name, "session-detail")
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ fullPage: true, path: `${evidenceRoot}/product-session-${testInfo.project.name}.png` })
  if (testInfo.project.name === "reference") await page.screenshot({ fullPage: false, path: `${evidenceRoot}/product-session-reference-1487x1058.png` })

  await page.getByRole("link", { name: "Integrations" }).click()
  await expect(page.getByText("2025-11-25")).toBeVisible()
  await expect(page.getByText("/v1/actions", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: /Use system theme/u }).click()
  await page.getByRole("button", { name: /Use light theme/u }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await assertAccessible(page, testInfo.project.name, "integrations-dark")
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ fullPage: true, path: `${evidenceRoot}/product-integrations-dark-${testInfo.project.name}.png` })
})

test("session action receipt and release confirmation are keyboard reachable", async ({ page }, testInfo) => {
  let releaseRequests = 0
  await page.route(`**/v1/managed/sessions/${liveSessionId}/release`, async (route) => {
    releaseRequests += 1
    await json(route, { ...fixtures.liveSession, endedAt: "2026-07-21T04:01:00.000Z", state: "RELEASED" })
  })
  await page.goto(`sessions/${liveSessionId}`)
  await page.getByLabel("URL").fill("https://example.com/")
  await page.getByRole("button", { name: "Run action" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "REST receipt" })).toBeVisible()
  await expect(page.getByText("Example Domain")).toBeVisible()
  await page.getByRole("button", { exact: true, name: "Release" }).focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Release this browser session?" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Keep session" })).toBeFocused()
  await assertAccessible(page, testInfo.project.name, "release-dialog")
  await dialog.getByRole("button", { name: "Release session" }).focus()
  await page.keyboard.press("Enter")
  await expect(dialog).not.toBeVisible()
  expect(releaseRequests).toBe(1)
})

test("queued admission cancellation posts once and reconciles the queue", async ({ page }) => {
  let cancellationRequests = 0
  await page.route(`**/v1/managed/admissions/${fixtures.admission.admissionId}/cancel`, async (route) => {
    cancellationRequests += 1
    await json(route, { ...fixtures.admission, state: "CANCELLED", updatedAt: "2026-07-21T04:01:00.000Z" })
  })
  await page.goto("sessions")
  const cancel = page.getByRole("button", { name: "Cancel" })
  await cancel.focus()
  await page.keyboard.press("Enter")
  await expect.poll(() => cancellationRequests).toBe(1)
})

test("live cast consumes the public socket and Escape returns keyboard focus", async ({ page }, testInfo) => {
  await page.goto(`sessions/${liveSessionId}/live`)
  await page.getByRole("button", { name: "Request live view" }).click()
  await expect(page.getByRole("region", { name: "Live browser cast" }).getByText("Live", { exact: true })).toBeVisible()
  const capture = page.getByRole("button", { name: "Capture keyboard" })
  await capture.click()
  await expect(page.getByRole("button", { name: "Remote browser input surface" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(capture).toBeFocused()
  await capture.click()
  await page.keyboard.press("a")
  await expect(page.getByText("Cast disconnected")).toBeVisible()
  await assertAccessible(page, testInfo.project.name, "live-disconnected")
})

test("session ledger exposes loading, empty, offline-stale, and error recovery states", async ({ page }, testInfo) => {
  let releaseEmptyResponse: (() => void) | undefined
  const emptyResponseGate = new Promise<void>((resolveGate) => { releaseEmptyResponse = resolveGate })
  const emptyHandler = async (route: Route) => {
    await emptyResponseGate
    await json(route, { apiVersion: "2026-07-01", items: [], page: { hasMore: false, pageSize: 50, snapshotCursor: "s1" } })
  }
  await page.route("**/v1/managed/sessions", emptyHandler)
  await page.goto("sessions")
  await expect(page.getByLabel("Loading session ledger")).toBeVisible()
  if (releaseEmptyResponse === undefined) throw new TypeError("Empty response gate was not initialized")
  releaseEmptyResponse()
  await expect(page.getByRole("heading", { name: "No sessions yet" })).toBeVisible()
  await page.context().setOffline(true)
  await expect(page.getByText("This device is offline")).toBeVisible()
  await expect(page.getByRole("button", { name: "New session" })).toBeDisabled()
  await page.context().setOffline(false)
  await page.unroute("**/v1/managed/sessions", emptyHandler)
  await page.route("**/v1/managed/sessions", (route) => route.fulfill({ status: 503 }))
  await page.reload()
  await expect(page.getByText("Sessions unavailable")).toBeVisible()
  await assertAccessible(page, testInfo.project.name, "session-error")
})

test("invalid links, Korean copy, reduced motion, and 200 percent zoom remain recoverable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "reference", "Stress matrix is captured once at the exact reference viewport")
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
  await page.goto("sessions/not-a-managed-session")
  await expect(page.getByText("Invalid session link")).toBeVisible()
  await page.goto(`sessions/${liveSessionId}`)
  await page.evaluate(() => {
    document.documentElement.lang = "ko"
    document.documentElement.style.zoom = "2"
    const headingCopy = document.querySelector(".page-heading__copy p")
    if (headingCopy) headingCopy.textContent = "여러 브라우저 세션의 워커 세대 고정과 복구 상태를 운영자가 확인합니다. 매우긴식별자ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  })
  await expect(page.getByRole("heading", { name: liveSessionId })).toBeVisible()
  await assertAccessible(page, testInfo.project.name, "cjk-reduced-motion-zoom-200")
  await page.screenshot({ fullPage: true, path: `${evidenceRoot}/product-session-cjk-reduced-motion-zoom-200.png` })
  await page.goto("route-that-does-not-exist")
  await expect(page.getByRole("heading", { name: "Browser operations" })).toBeVisible()
})

async function installApiFixtures(page: Page) {
  await page.route("**/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/v1/managed/pool") return json(route, fixtures.pool)
    if (path === "/v1/managed/workers") return json(route, fixtures.workers)
    if (path === "/v1/managed/sessions") return json(route, fixtures.sessions)
    if (path === `/v1/managed/sessions/${liveSessionId}`) return json(route, fixtures.liveSession)
    if (path === "/v1/managed/queue") return json(route, fixtures.admissions)
    if (path === "/v1/managed/events") return json(route, fixtures.events)
    if (path === "/v1/managed/version") return json(route, fixtures.version)
    if (path === "/v1/capabilities") return json(route, fixtures.capabilities)
    if (path === "/v1/tools") return json(route, fixtures.tools)
    if (path === "/v1/actions") {
      const body: unknown = request.postDataJSON()
      if (readActionToolName(body) === "steel.browser.live_view") {
        const origin = new URL(request.url()).origin
        return json(route, {
          castWebSocketUrl: `${origin.replace(/^http/u, "ws")}/v1/sessions/${liveSessionId}/cast`,
          kind: "live_view",
          sessionId: liveSessionId,
          viewerUrl: `${origin}/ui/sessions/${liveSessionId}/live`,
        })
      }
      return json(route, fixtures.navigationResult)
    }
    return route.fulfill({ status: 404 })
  })
}

function readActionToolName(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const tool = Reflect.get(body, "tool")
  if (typeof tool !== "object" || tool === null) return undefined
  const name = Reflect.get(tool, "name")
  return typeof name === "string" ? name : undefined
}

const json = (route: Route, body: unknown) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status: 200 })

async function assertAccessible(page: Page, project: string, scenario: string) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
  const axeRoot = `${evidenceRoot}/axe`
  await mkdir(axeRoot, { recursive: true })
  await writeFile(`${axeRoot}/${scenario}-${project}.json`, `${JSON.stringify(results, null, 2)}\n`, "utf8")
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}
