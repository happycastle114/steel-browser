import { readFile } from "node:fs/promises"

import { CREATE_JOURNAL_BINDING, SESSION_ID_MODE } from "./corpus-schema.mjs"
import { assembleRuntimeCorpus } from "./runtime-corpus.mjs"
import { containsSessionId, probeRest, probeWebSocket, readContainerBrowserVersion, readContainerRuntimeVersion, startExactWorker, stopExactWorker } from "./runtime-probes.mjs"
import { HTTP_METHOD, PROTOCOL, bindReviewedRoutePlan, discoverRoutes, readPinnedSources } from "./runtime-route-source.mjs"

const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u
const CALLER_SESSION_ID = "11111111-2222-4333-8444-555555555555"
const SECONDARY_SESSION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

function blocked(message) {
  const error = new Error(message)
  error.name = "RuntimeCaptureBlocked"
  error.code = "RUNTIME_CAPTURE_BLOCKED"
  throw error
}

function browserVersionNumber(value) {
  return value.match(/\b(\d+\.\d+\.\d+\.\d+)\b/u)?.[1]
}

async function captureAgainstWorker({ repositoryRoot, upstreamSha, workerImageDigest, capturePlan, baseUrl, containerId }) {
  const sources = await readPinnedSources(repositoryRoot)
  const discovered = discoverRoutes(sources)
  const matrixRoutes = bindReviewedRoutePlan(discovered, capturePlan)
  const restRoutes = matrixRoutes.filter((route) => route.protocol === PROTOCOL.REST)
  const webSocketRoutes = matrixRoutes.filter((route) => route.protocol === PROTOCOL.WEBSOCKET)
  const createRoute = restRoutes.find((route) => route.id === "rest.sessions.create")
  if (createRoute === undefined || process.env.STEEL_RUNTIME_SESSION_ID_MODE !== SESSION_ID_MODE.CLIENT_SUPPLIED) blocked("reviewed capture plan must use client-supplied session IDs")
  const createProbe = await probeRest(baseUrl, createRoute, CALLER_SESSION_ID)
  if (createProbe.json?.id !== CALLER_SESSION_ID) blocked("live session create did not retain the reviewed caller session ID")
  const restRecordByRoute = new Map([[createRoute.id, createProbe.record]])
  let listRecovered = false
  let getRecovered = false
  for (const route of restRoutes) {
    if (route.id === createRoute.id || route.id === "rest.sessions.release-id" || route.id === "rest.sessions.release-active") continue
    const probe = await probeRest(baseUrl, route, CALLER_SESSION_ID)
    restRecordByRoute.set(route.id, probe.record)
    if (route.id === "rest.sessions.list") listRecovered = containsSessionId(probe.json, CALLER_SESSION_ID)
    if (route.id === "rest.sessions.get") getRecovered = containsSessionId(probe.json, CALLER_SESSION_ID)
  }
  let cdpBrowserProduct
  const webSocketRecords = []
  for (const route of webSocketRoutes) {
    const probe = await probeWebSocket(baseUrl, route)
    webSocketRecords.push(probe.record)
    if (route.id === "ws.root-cdp") cdpBrowserProduct = probe.browserProduct
  }
  const releaseById = restRoutes.find((route) => route.id === "rest.sessions.release-id")
  const releaseActive = restRoutes.find((route) => route.id === "rest.sessions.release-active")
  if (releaseById === undefined || releaseActive === undefined) blocked("reviewed session release routes are unavailable")
  const releaseByIdProbe = await probeRest(baseUrl, releaseById, CALLER_SESSION_ID)
  restRecordByRoute.set(releaseById.id, releaseByIdProbe.record)
  const secondaryCreate = await probeRest(baseUrl, createRoute, SECONDARY_SESSION_ID)
  if (secondaryCreate.json?.id !== SECONDARY_SESSION_ID) blocked("secondary live session did not retain its reviewed caller ID")
  const releaseActiveProbe = await probeRest(baseUrl, releaseActive, SECONDARY_SESSION_ID)
  restRecordByRoute.set(releaseActive.id, releaseActiveProbe.record)
  const releaseReturnedActiveId = containsSessionId(releaseByIdProbe.json, CALLER_SESSION_ID) && containsSessionId(releaseActiveProbe.json, SECONDARY_SESSION_ID)
  if (!listRecovered || !getRecovered || !releaseReturnedActiveId) blocked("live session lifecycle did not prove list, get, and release identity binding")
  const restRecords = restRoutes.map((route) => restRecordByRoute.get(route.id))
  if (restRecords.some((record) => record === undefined)) blocked("one or more reviewed REST routes have no live observation")
  const [executableBrowserVersion, runtimeVersion] = await Promise.all([readContainerBrowserVersion(containerId), readContainerRuntimeVersion(containerId)])
  if (typeof cdpBrowserProduct !== "string" || browserVersionNumber(cdpBrowserProduct) !== browserVersionNumber(executableBrowserVersion)) blocked("Browser.getVersion does not match the exact container Chromium executable")
  return {
    browserVersion: cdpBrowserProduct,
    runtimeVersion,
    workerImageDigest,
    artifacts: assembleRuntimeCorpus({ upstreamSha, sources, discovered, matrixRoutes, restRecords, webSocketRecords, sessionVerdict: { mode: SESSION_ID_MODE.CLIENT_SUPPLIED, callerSessionId: CALLER_SESSION_ID, createReturnedCallerId: createProbe.json?.id === CALLER_SESSION_ID, freshConnectionListRecoveredActiveId: listRecovered, freshConnectionGetRecoveredActiveId: getRecovered, releaseReturnedActiveId, createJournalBinding: CREATE_JOURNAL_BINDING.CLIENT_ID_DIRECT } }),
  }
}

export async function observeSteelRuntime({ repositoryRoot, upstreamSha }) {
  const imageSubject = process.env.STEEL_WORKER_IMAGE_DIGEST_FILE
  const planSubject = process.env.STEEL_RUNTIME_CAPTURE_PLAN_FILE
  if (typeof imageSubject !== "string" || typeof planSubject !== "string" || imageSubject.trim() === "" || planSubject.trim() === "") blocked("exact worker image or reviewed capture plan is unavailable")
  const workerImageDigest = (await readFile(imageSubject, "utf8")).trim()
  if (!IMAGE_DIGEST_PATTERN.test(workerImageDigest)) blocked("exact worker image subject is not a pinned digest")
  const capturePlan = JSON.parse(await readFile(planSubject, "utf8"))
  let container
  try {
    container = await startExactWorker(workerImageDigest)
    return await captureAgainstWorker({ repositoryRoot, upstreamSha, workerImageDigest, capturePlan, ...container })
  } catch (error) {
    if (error?.code === "RUNTIME_CAPTURE_BLOCKED") throw error
    blocked(`exact Steel worker runtime capture failed: ${error instanceof Error ? error.message : "unknown failure"}`)
  } finally {
    if (container?.containerId !== undefined) await stopExactWorker(container.containerId)
  }
}
