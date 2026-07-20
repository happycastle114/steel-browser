import { describe, expect, it } from "vitest"
import {
  AmbiguousSessionAffinityError,
  SessionNotFoundError,
  resolveSessionAffinity,
} from "../src/index.js"
import { publicSessionId } from "./test-support.js"

describe("resolveSessionAffinity", () => {
  const sessionOne = publicSessionId(1)
  const sessionTwo = publicSessionId(2)

  it("uses path, header, and query hints in that order", () => {
    // Given
    const liveSessions = [sessionOne, sessionTwo]

    // When
    const selected = resolveSessionAffinity(
      { path: sessionOne, header: sessionTwo, query: sessionTwo },
      liveSessions,
    )

    // Then
    expect(selected).toBe(sessionOne)
  })

  it("keeps sole-live-session compatibility without a hint", () => {
    // Given / When
    const selected = resolveSessionAffinity({}, [sessionOne])

    // Then
    expect(selected).toBe(sessionOne)
  })

  it("fails closed when multiple sessions are live without a hint", () => {
    // Given / When
    const resolve = () => resolveSessionAffinity({}, [sessionOne, sessionTwo])

    // Then
    expect(resolve).toThrow(AmbiguousSessionAffinityError)
  })

  it("fails closed for an unknown explicit session", () => {
    // Given / When
    const resolve = () =>
      resolveSessionAffinity({ header: publicSessionId(3) }, [sessionOne])

    // Then
    expect(resolve).toThrow(SessionNotFoundError)
  })
})
