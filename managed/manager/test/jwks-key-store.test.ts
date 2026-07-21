import { describe, expect, it } from "vitest"
import {
  JwksKeyStore,
  UnknownKidCache,
  type JwksFetcher,
} from "../src/auth/jwks-key-store.js"
import { AuthenticationFailure } from "../src/auth/jwt-authenticator.js"
import { signingFixture } from "./jwt-fixture.js"
import { MutableClock } from "./test-clock.js"

describe("JWKS key-store boundaries", () => {
  it("coalesces concurrent refreshes into one fetch", async () => {
    // Given: two key requests while the first JWKS fetch is pending.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("coalesced")
    let release: (() => void) | undefined
    let calls = 0
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetcher: JwksFetcher = {
      fetch: async () => {
        calls += 1
        await pending
        return [key.jwk]
      },
    }
    const store = new JwksKeyStore({ clock, fetcher })

    // When: both callers resolve the same kid concurrently.
    const first = store.resolve("coalesced")
    const second = store.resolve("coalesced")
    release?.()
    await Promise.all([first, second])

    // Then: only one network refresh occurred.
    expect(calls).toBe(1)
  })

  it("negative-caches an unknown kid for exactly thirty seconds", async () => {
    // Given: a JWKS that does not contain the requested kid.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("present")
    let calls = 0
    const store = new JwksKeyStore({
      clock,
      fetcher: {
        fetch: async () => {
          calls += 1
          return [key.jwk]
        },
      },
    })

    // When: the unknown kid repeats within the negative-cache TTL.
    await expect(store.resolve("missing")).rejects.toMatchObject({
      code: AuthenticationFailure.UNKNOWN_KID,
    })
    clock.advance(29_999)
    await expect(store.resolve("missing")).rejects.toMatchObject({
      code: AuthenticationFailure.UNKNOWN_KID,
    })

    // Then: the second request performs no refresh, but expiry permits a new one.
    expect(calls).toBe(1)
    clock.advance(2)
    await expect(store.resolve("missing")).rejects.toMatchObject({
      code: AuthenticationFailure.UNKNOWN_KID,
    })
    expect(calls).toBe(2)
  })

  it("admits at most six refreshes per sliding minute", async () => {
    // Given: six different unknown kids consume the configured refresh bucket.
    const clock = new MutableClock(1_800_000_000_000)
    let calls = 0
    const store = new JwksKeyStore({
      clock,
      fetcher: {
        fetch: async () => {
          calls += 1
          return []
        },
      },
    })
    for (let index = 0; index < 6; index += 1) {
      await expect(store.resolve(`missing-${index}`)).rejects.toMatchObject({
        code: AuthenticationFailure.JWKS_UNAVAILABLE,
      })
    }

    // When: a seventh unknown kid would trigger another refresh.
    const seventh = store.resolve("missing-seventh")

    // Then: the bucket rejects it without a seventh fetch.
    await expect(seventh).rejects.toMatchObject({
      code: AuthenticationFailure.JWKS_RATE_LIMITED,
    })
    expect(calls).toBe(6)
  })

  it("rejects weak RSA material before key construction", async () => {
    // Given
    const clock = new MutableClock(1_800_000_000_000)
    const weak = signingFixture("weak", 512)
    const store = new JwksKeyStore({
      clock,
      fetcher: { fetch: async () => [weak.jwk] },
    })

    // When / Then
    await expect(store.resolve("weak")).rejects.toMatchObject({
      code: AuthenticationFailure.JWKS_UNAVAILABLE,
    })
  })

  it("uses grace for malformed refresh only while the cached key remains valid", async () => {
    // Given
    const clock = new MutableClock(1_800_000_000_000)
    const valid = signingFixture("grace")
    const expiring = {
      ...valid.jwk,
      notAfterMilliseconds: clock.nowMilliseconds() + 300_500,
    }
    const weak = signingFixture("weak-refresh", 512)
    let malformed = false
    const store = new JwksKeyStore({
      clock,
      fetcher: { fetch: async () => (malformed ? [weak.jwk] : [expiring]) },
    })
    await store.resolve("grace")

    // When
    malformed = true
    clock.advance(300_001)

    // Then
    await expect(store.resolve("grace")).resolves.toBeDefined()
    clock.advance(500)
    await expect(store.resolve("grace")).rejects.toMatchObject({
      code: AuthenticationFailure.JWKS_UNAVAILABLE,
    })
  })

  it("evicts the oldest entry when the 256-entry unknown-kid bound is exceeded", () => {
    // Given: a standalone negative cache with the production capacity and TTL.
    const clock = new MutableClock(1_800_000_000_000)
    const cache = new UnknownKidCache(clock)

    // When: one more than the bounded number of unique kids is recorded.
    for (let index = 0; index < 257; index += 1) cache.record(`kid-${index}`)

    // Then: capacity remains fixed and the oldest kid was evicted.
    expect(cache.size()).toBe(256)
    expect(cache.has("kid-0")).toBe(false)
    expect(cache.has("kid-256")).toBe(true)
  })
})
