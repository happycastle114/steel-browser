import { describe, expect, it } from "vitest"

import committedLockInput from "../../upstream.lock.json"
import { LOCK_STAGE, parseUpstreamLock } from "../src/upstream-lock.js"

const UPSTREAM_SHA = "5880b48c1af107219ff3d904edbb8f6b76bea9b6"
const DIGEST = "a".repeat(64)

const bootstrapLock = {
  schemaVersion: 1,
  lockStage: LOCK_STAGE.BOOTSTRAP,
  upstreamRepository: "steel-dev/steel-browser",
  upstreamSha: UPSTREAM_SHA,
}

describe("upstream lock boundary", () => {
  it("parses the committed corpus-locked lock", () => {
    // Given
    const input = committedLockInput

    // When
    const parsed = parseUpstreamLock(input)

    // Then
    expect(parsed.lockStage).toBe(LOCK_STAGE.CORPUS_LOCKED)
  })

  it("parses the bootstrap stage when only bootstrap fields are present", () => {
    // Given
    const input = bootstrapLock

    // When
    const parsed = parseUpstreamLock(input)

    // Then
    expect(parsed).toEqual(input)
  })

  it("rejects later-stage digests in a bootstrap lock", () => {
    // Given
    const input = { ...bootstrapLock, protocolCorpusSha256: DIGEST }

    // When
    const parse = () => parseUpstreamLock(input)

    // Then
    expect(parse).toThrow()
  })

  it("rejects a corpus-locked stage without its corpus and session verdict digests", () => {
    // Given
    const input = { ...bootstrapLock, lockStage: LOCK_STAGE.CORPUS_LOCKED }

    // When
    const parse = () => parseUpstreamLock(input)

    // Then
    expect(parse).toThrow()
  })

  it("parses the final stage when every required digest is present", () => {
    // Given
    const input = {
      ...bootstrapLock,
      lockStage: LOCK_STAGE.FINAL,
      protocolCorpusSha256: DIGEST,
      sessionIdVerdictSha256: DIGEST,
      browserRuntimeContractSha256: DIGEST,
      licenseManifestSha256: DIGEST,
      scopeManifestSha256: DIGEST,
    }

    // When
    const parsed = parseUpstreamLock(input)

    // Then
    expect(parsed).toEqual(input)
  })

  it("rejects a final stage with a missing scope digest", () => {
    // Given
    const input = {
      ...bootstrapLock,
      lockStage: LOCK_STAGE.FINAL,
      protocolCorpusSha256: DIGEST,
      sessionIdVerdictSha256: DIGEST,
      browserRuntimeContractSha256: DIGEST,
      licenseManifestSha256: DIGEST,
    }

    // When
    const parse = () => parseUpstreamLock(input)

    // Then
    expect(parse).toThrow()
  })

  it("rejects an unknown lock stage", () => {
    // Given
    const input = { ...bootstrapLock, lockStage: "UNKNOWN" }

    // When
    const parse = () => parseUpstreamLock(input)

    // Then
    expect(parse).toThrow()
  })
})
