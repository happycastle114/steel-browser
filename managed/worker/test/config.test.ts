import { describe, expect, it } from "vitest"
import {
  WORKER_BIND_ADDRESS,
  assertNode22Runtime,
  parseWorkerConfig,
} from "../src/config.js"

describe("parseWorkerConfig", () => {
  it("parses a configured stable worker identity", () => {
    // Given
    const environment = { MANAGED_WORKER_ID: "worker-01" }

    // When
    const config = parseWorkerConfig(environment)

    // Then
    expect(config).toEqual({ workerId: "worker-01" })
  })

  it.each([undefined, "", "worker-1", "worker-02", "worker-32", "manager-00"])(
    "rejects an invalid worker identity %s",
    (workerId) => {
      // Given
      const environment = workerId === undefined ? {} : { MANAGED_WORKER_ID: workerId }

      // When
      const parse = () => parseWorkerConfig(environment)

      // Then
      expect(parse).toThrow()
    },
  )

  it.each([
    { HOST: "127.0.0.1", MANAGED_WORKER_ID: "worker-00" },
    { MANAGED_WORKER_ID: "worker-00", PORT: "3001" },
    { MANAGED_WORKER_HOST: "0.0.0.0", MANAGED_WORKER_ID: "worker-00" },
    { MANAGED_WORKER_ID: "worker-00", MANAGED_WORKER_PORT: "3000" },
  ])("rejects a bind override", (environment) => {
    // Given
    const untrustedEnvironment = environment

    // When
    const parse = () => parseWorkerConfig(untrustedEnvironment)

    // Then
    expect(parse).toThrow()
  })

  it("uses the fixed private-network listener", () => {
    // Given
    const expectedAddress = { host: "0.0.0.0", port: 3000 }

    // When
    const address = WORKER_BIND_ADDRESS

    // Then
    expect(address).toEqual(expectedAddress)
  })

  it("accepts Node 22 and rejects other runtime majors", () => {
    // Given
    const acceptedVersion = "22.23.1"
    const rejectedVersions = ["21.7.3", "23.0.0", "22", "v22.23.1"]

    // When
    const accept = () => assertNode22Runtime(acceptedVersion)
    const rejects = rejectedVersions.map(
      (version) => () => assertNode22Runtime(version),
    )

    // Then
    expect(accept).not.toThrow()
    for (const reject of rejects) {
      expect(reject).toThrow()
    }
  })
})
