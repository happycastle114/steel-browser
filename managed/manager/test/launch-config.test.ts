import { describe, expect, it } from "vitest"
import {
  MANAGER_HEALTHCHECK_URL,
  MANAGER_RELEASE_EVIDENCE_PATH,
  MANAGER_TOKEN_KEY_PATH,
  parseHealthcheckArguments,
  parseManagerArguments,
} from "../src/launch-config.js"

const blueArguments = [
  "--pool-id=managed-blue-pool",
  "--worker=worker-00=http://worker-00:3000",
  "--worker=worker-01=http://worker-01:3000",
  "--public-bind=0.0.0.0:3000",
  "--health-bind=127.0.0.1:3001",
  `--create-token-key-file=${MANAGER_TOKEN_KEY_PATH}`,
  `--release-evidence-file=${MANAGER_RELEASE_EVIDENCE_PATH}`,
  `--release-evidence-sha256=${"a".repeat(64)}`,
] as const

const argumentMutations: readonly (readonly string[])[] = [
  blueArguments.slice(0, -1),
  [...blueArguments, "--debug"],
  [blueArguments[0], blueArguments[2], blueArguments[1], ...blueArguments.slice(3)],
  ["--pool-id=other", ...blueArguments.slice(1)],
  [...blueArguments.slice(0, -1), `--release-evidence-sha256=${"A".repeat(64)}`],
]

describe("manager launch contract", () => {
  it("parses the exact blue Compose command without defaults", () => {
    const parsed = parseManagerArguments(blueArguments)

    expect(parsed.poolId).toBe("managed-blue-pool")
    expect(parsed.workers.map((worker) => [worker.id, worker.origin.href])).toEqual([
      ["worker-00", "http://worker-00:3000/"],
      ["worker-01", "http://worker-01:3000/"],
    ])
    expect(parsed).toMatchObject({
      healthHost: "127.0.0.1",
      healthPort: 3_001,
      publicHost: "0.0.0.0",
      publicPort: 3_000,
      releaseEvidencePath: MANAGER_RELEASE_EVIDENCE_PATH,
      releaseEvidenceSha256: "a".repeat(64),
      tokenKeyPath: MANAGER_TOKEN_KEY_PATH,
    })
  })

  it("accepts only the exact green pool mutation", () => {
    const parsed = parseManagerArguments([
      "--pool-id=managed-green-pool",
      ...blueArguments.slice(1),
    ])

    expect(parsed.poolId).toBe("managed-green-pool")
  })

  it.each(argumentMutations.map((mutation) => [mutation] as const))(
    "rejects a manager argument mutation",
    (mutation) => {
    expect(() => parseManagerArguments(mutation)).toThrow()
    },
  )

  it("accepts only the fixed loopback liveness healthcheck URL", () => {
    expect(parseHealthcheckArguments([MANAGER_HEALTHCHECK_URL])).toBe(MANAGER_HEALTHCHECK_URL)
    expect(() => parseHealthcheckArguments([])).toThrow()
    expect(() => parseHealthcheckArguments(["http://0.0.0.0:3001/readyz"])).toThrow()
  })
})
