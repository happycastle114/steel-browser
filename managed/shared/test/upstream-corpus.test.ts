import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import committedLockInput from "../../upstream.lock.json"
import { loadCorpusBundle } from "../src/upstream-corpus-files.js"
import {
  CorpusManifestSchema,
  CREATE_JOURNAL_BINDING,
  RouteMatrixSchema,
  SESSION_ID_MODE,
  SessionIdVerdictSchema,
  WebSocketCorpusEntrySchema,
} from "../src/upstream-corpus-model.js"
import {
  CorpusVerificationError,
  verifyCorpusBundle,
} from "../src/upstream-corpus-verifier.js"
import { LOCK_STAGE, parseUpstreamLock } from "../src/upstream-lock.js"

const PINNED_UPSTREAM_SHA = "c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2"
const CORPUS_DIRECTORY = fileURLToPath(
  new URL(`../../tests/upstream/${PINNED_UPSTREAM_SHA}/`, import.meta.url),
)
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const REQUIRED_CORPUS_FILES = [
  "manifest.json",
  "observed-receipt.json",
  "rest.ndjson",
  "websocket.ndjson",
  "route-matrix.json",
  "session-id-verdict.json",
] as const

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

describe("committed upstream protocol corpus", () => {
  it.each(REQUIRED_CORPUS_FILES)("commits %s", (fileName) => {
    // Given
    const corpusPath = new URL(fileName, `file://${CORPUS_DIRECTORY}`)

    // When
    const isCommitted = existsSync(corpusPath)

    // Then
    expect(isCommitted).toBe(true)
  })

  it("advances the committed lock when the corpus is locked", () => {
    // Given
    const input = committedLockInput

    // When
    const parsed = parseUpstreamLock(input)

    // Then
    expect(parsed.lockStage).toBe(LOCK_STAGE.CORPUS_LOCKED)
  })

  it("verifies the committed corpus through the repository command", () => {
    // Given
    const invocation = ["run", "verify:upstream-corpus"] as const

    // When
    const result = spawnSync("npm", invocation, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    })

    // Then
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("UPSTREAM_CORPUS_VERIFIED")
  })

  it("rejects a route matrix that omits one pinned runtime route", async () => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const matrix = RouteMatrixSchema.parse(JSON.parse(bundle.routeMatrixText))
    const mutated = { ...bundle, routeMatrixText: toJson({ ...matrix, routes: matrix.routes.slice(1) }) }

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrowError(CorpusVerificationError)
    expect(verify).toThrow("route matrix does not cover the pinned runtime source")
  })

  it("rejects a manifest with one wrong artifact digest", async () => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const manifest = CorpusManifestSchema.parse(JSON.parse(bundle.manifestText))
    const artifacts = manifest.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, sha256: "b".repeat(64) } : artifact,
    )
    const mutated = { ...bundle, manifestText: toJson({ ...manifest, artifacts }) }

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrowError(CorpusVerificationError)
    expect(verify).toThrow("artifact digest drift")
  })

  it("rejects a session verdict that claims the wrong executable mode", async () => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const verdict = SessionIdVerdictSchema.parse(JSON.parse(bundle.sessionIdVerdictText))
    const mutatedVerdict = {
      ...verdict,
      mode: SESSION_ID_MODE.UPSTREAM_RETURNED,
      createJournalBinding: CREATE_JOURNAL_BINDING.CREATE_TOKEN_TO_UPSTREAM_RETURNED_ID,
    } as const
    const mutated = { ...bundle, sessionIdVerdictText: toJson(mutatedVerdict) }

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrowError(CorpusVerificationError)
    expect(verify).toThrow("returned-ID mode retained caller ID")
  })

  it("rejects a stale upstream SHA in the session verdict", async () => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const verdict = SessionIdVerdictSchema.parse(JSON.parse(bundle.sessionIdVerdictText))
    const mutated = {
      ...bundle,
      sessionIdVerdictText: toJson({ ...verdict, upstreamSha: "0".repeat(40) }),
    }

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrowError(CorpusVerificationError)
    expect(verify).toThrow("session verdict upstream SHA drift")
  })

  it("rejects a malformed corpus entry", async () => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const mutated = { ...bundle, restText: "{}\n" }

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrow()
  })

  it("rejects a WebSocket record with the wrong upgrade path", async () => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const records = bundle.webSocketText.trimEnd().split("\n").map((line) =>
      WebSocketCorpusEntrySchema.parse(JSON.parse(line)),
    )
    const [firstRecord, ...remainingRecords] = records
    if (firstRecord === undefined) {
      throw new CorpusVerificationError("WebSocket fixture is empty")
    }
    const mutatedRecords = [
      { ...firstRecord, requestPath: "/wrong-upgrade" },
      ...remainingRecords,
    ]
    const mutated = {
      ...bundle,
      webSocketText: `${mutatedRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    }

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrowError(CorpusVerificationError)
    expect(verify).toThrow("WebSocket path drift")
  })
})
