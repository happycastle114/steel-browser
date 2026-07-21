import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { assembleRuntimeCorpus } from "./runtime-corpus.mjs"
import { probeRest, readContainerRuntimeVersion, startExactWorker } from "./runtime-probes.mjs"
import { PROTOCOL, bindReviewedRoutePlan, discoverRoutes, readPinnedSources } from "./runtime-route-source.mjs"

const lock = JSON.parse(await readFile(path.resolve("managed/upstream.lock.json"), "utf8"))
const plan = JSON.parse(await readFile(path.resolve("managed/tests/upstream", lock.upstreamSha, "route-matrix.json"), "utf8"))

test("runtime route source is exactly the locked 37 REST and 5 WebSocket semantic oracle", async () => {
  const discovered = discoverRoutes(await readPinnedSources(process.cwd()))
  const routes = bindReviewedRoutePlan(discovered, plan)
  assert.equal(routes.filter((route) => route.protocol === PROTOCOL.REST).length, 37)
  assert.equal(routes.filter((route) => route.protocol === PROTOCOL.WEBSOCKET).length, 5)
  assert.equal(new Set(routes.map((route) => route.id)).size, 42)
  const drifted = structuredClone(discovered)
  drifted[0].path = "/unreviewed"
  assert.throws(() => bindReviewedRoutePlan(drifted, plan), (error) => error?.code === "RUNTIME_CAPTURE_BLOCKED")
})

test("live REST actuals cannot redefine reviewed status expectations", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(201, { "content-type": "application/json; charset=utf-8" })
    response.end('{"status":"ok"}')
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const route = structuredClone(plan.routes.find((candidate) => candidate.id === "rest.health"))
  await assert.rejects(probeRest(`http://127.0.0.1:${address.port}`, route, "11111111-2222-4333-8444-555555555555"), (error) => error?.code === "RUNTIME_CAPTURE_BLOCKED" && /status drift/u.test(error.message))
})

test("live REST capture aborts an unreviewed oversized response", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "transfer-encoding": "chunked" })
    response.end(`"${"x".repeat(1024 * 1024)}"`)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const route = structuredClone(plan.routes.find((candidate) => candidate.id === "rest.health"))
  await assert.rejects(probeRest(`http://127.0.0.1:${address.port}`, route, "11111111-2222-4333-8444-555555555555"), (error) => error?.code === "RUNTIME_CAPTURE_BLOCKED" && /response body exceeded/u.test(error.message))
})

test("runtime corpus preserves reviewed expectations instead of deriving them from actual records", () => {
  const matrixRoute = structuredClone(plan.routes.find((candidate) => candidate.id === "rest.health"))
  const record = { schemaVersion: 1, id: "record.rest.health", routeId: "rest.health", scenario: "fixture", request: { method: "GET", path: "/v1/health", bodyKind: "EMPTY" }, response: { status: 500, contentType: "application/json; charset=utf-8", headers: { "content-type": "application/json; charset=utf-8" }, bodyKind: "JSON", bodySha256: "a".repeat(64), urlFields: {} } }
  const artifacts = assembleRuntimeCorpus({ upstreamSha: "b".repeat(40), sources: [], discovered: [{ protocol: "REST", method: "GET", path: "/v1/health", source: matrixRoute.source }], matrixRoutes: [matrixRoute], restRecords: [record], webSocketRecords: [], sessionVerdict: { mode: "CLIENT_SUPPLIED" } })
  const matrix = JSON.parse(artifacts.find((artifact) => artifact.path === "route-matrix.json").text)
  assert.deepEqual(matrix.routes[0].expected, matrixRoute.expected)
  assert.equal(matrix.routes[0].expected.statuses.includes(500), false)
  assert.equal(JSON.parse(artifacts.find((artifact) => artifact.path === "rest.ndjson").text).response.status, 500)
})

test("exact worker launch pins DBus entrypoint and a non-root read-only no-host-mount sandbox", async () => {
  const calls = []
  const execute = async (command, args) => {
    calls.push({ command, args })
    return args[0] === "run" ? { stdout: `${"a".repeat(64)}\n`, stderr: "" } : { stdout: "127.0.0.1:43123\n", stderr: "" }
  }
  const request = async () => new Response('{"status":"ok"}', { status: 200, headers: { "content-type": "application/json" } })
  const image = `sha256:${"b".repeat(64)}`
  assert.deepEqual(await startExactWorker(image, { execute, request }), { containerId: "a".repeat(64), baseUrl: "http://127.0.0.1:43123" })
  const args = calls[0].args
  for (const required of ["--read-only", "10001:10001", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "/tmp:rw,nosuid,nodev,mode=1777", "/run:rw,nosuid,nodev,size=64m,mode=0755", "/files:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700", "/app/.cache:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700", "127.0.0.1::3000", "/usr/bin/dbus-run-session", image, "/app/api/entrypoint.sh", "--no-nginx"]) assert.ok(args.includes(required), required)
  assert.deepEqual(args.slice(args.indexOf("--entrypoint")), ["--entrypoint", "/usr/bin/dbus-run-session", image, "--", "/app/api/entrypoint.sh", "--no-nginx"])
  assert.equal(args.filter((value) => value === "--publish").length, 1)
  assert.equal(args.some((value) => /9223|docker\.sock|--privileged|--volume|-v/u.test(value)), false)
})

test("exact worker launch removes a detached container when startup fails", async () => {
  const containerId = "a".repeat(64)
  const calls = []
  const execute = async (command, args) => {
    calls.push({ command, args })
    if (args[0] === "run") return { stdout: `${containerId}\n`, stderr: "" }
    if (args[0] === "port") throw new Error("port lookup failed")
    return { stdout: "", stderr: "" }
  }
  await assert.rejects(startExactWorker(`sha256:${"b".repeat(64)}`, { execute, request: fetch }), /port lookup failed/)
  assert.deepEqual(calls.at(-1), { command: "docker", args: ["rm", "--force", containerId] })
})

test("runtime identity reads Node from the exact worker container", async () => {
  const calls = []
  const execute = async (command, args) => {
    calls.push({ command, args })
    return { stdout: "v22.23.1\n", stderr: "" }
  }
  assert.equal(await readContainerRuntimeVersion("a".repeat(64), { execute }), "v22.23.1")
  assert.deepEqual(calls, [{ command: "docker", args: ["exec", "a".repeat(64), "node", "--version"] }])
})
