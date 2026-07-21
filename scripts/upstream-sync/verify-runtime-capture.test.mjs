import assert from "node:assert/strict"
import test from "node:test"

import { assertBrowserCdpEvidence } from "./verify-runtime-capture.mjs"
import { PROTOCOL } from "./runtime-route-source.mjs"

const exactEvidence = {
  matrix: { routes: [{ id: "ws.root-cdp", protocol: PROTOCOL.WEBSOCKET, path: "/", upgradeClass: "ROOT_CDP" }] },
  webSocketRecords: [{ routeId: "ws.root-cdp", messageKind: "BROWSER_GET_VERSION", opened: true }],
}
const runtimeIdentity = { browserVersion: "Chrome/140.0.7339.185" }

test("runtime capture evidence requires the root CDP Browser.getVersion observation", () => {
  assert.doesNotThrow(() => assertBrowserCdpEvidence(exactEvidence, runtimeIdentity))
  assert.throws(() => assertBrowserCdpEvidence({ ...exactEvidence, webSocketRecords: [{ ...exactEvidence.webSocketRecords[0], messageKind: "OPEN_NO_MESSAGE" }] }, runtimeIdentity), /Browser\.getVersion/)
})

test("runtime capture evidence rejects a fabricated browser identity", () => {
  assert.throws(() => assertBrowserCdpEvidence(exactEvidence, { browserVersion: "fixture/140.0" }), /browser identity/)
})
