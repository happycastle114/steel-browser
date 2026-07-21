import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  ManagerConfigurationError,
  loadManagerConfig,
  loadManagerConfigReceipt,
  parseManagerConfig,
} from "../src/config.js"
import { validManagerConfigInput, validPoolId } from "./fixtures.js"

describe("manager configuration boundary", () => {
  it("derives fixed limits when the typed deployment input is valid", () => {
    // Given: the minimum deployment-specific values and an injected UI asset root.
    const input = validManagerConfigInput()

    // When: the manager parses the external configuration.
    const config = parseManagerConfig(input, validPoolId())

    // Then: fixed Node and memory bounds come from the shared control-plane contract.
    expect(config.controlPlane.httpBodyBytes).toBe(2_097_152)
    expect(config.controlPlane.memory.ingressConnectionMax).toBeGreaterThanOrEqual(32)
    expect(config.uiAssetRoot).toBe("/srv/steel-console")
    expect(config.controlPlane.poolId).toBe("managed-blue-pool")
  })

  it("rejects a Host map that is not an exact allowed-Host mapping", () => {
    // Given: an allowed Host whose selected origin map names another Host.
    const valid = validManagerConfigInput()
    const input = {
      ...valid,
      publicEndpoints: [
        { ...valid.publicEndpoints[0], origin: "https://other.example.com" },
        valid.publicEndpoints[1],
      ],
    }

    // When: the boundary parses the mismatch.
    const parse = () => parseManagerConfig(input, validPoolId())

    // Then: startup is rejected before a listener exists.
    expect(parse).toThrow()
  })

  it("reports a typed startup error when the JSON environment value is absent", () => {
    // Given: a process environment without manager configuration.
    const environment = {}

    // When: startup loads its only configuration envelope.
    const load = () => loadManagerConfig(environment, validPoolId())

    // Then: the missing boundary value is typed.
    expect(load).toThrow(ManagerConfigurationError)
  })

  it("binds the parsed configuration to the exact raw environment bytes", () => {
    const serialized = `${JSON.stringify(validManagerConfigInput())}\n`

    const receipt = loadManagerConfigReceipt(
      { STEEL_MANAGED_CONFIG_JSON: serialized },
      validPoolId(),
    )

    expect(receipt.config.controlPlane.poolId).toBe("managed-blue-pool")
    expect(receipt.sha256).toBe(
      createHash("sha256").update(Buffer.from(serialized, "utf8")).digest("hex"),
    )
  })

  it("rejects an embedded pool ID instead of allowing environment/CLI drift", () => {
    // Given: an environment payload that tries to override the launch slot.
    const input = validManagerConfigInput()
    const controlPlane = { ...input.controlPlane, poolId: "managed-green-pool" }

    // When: startup combines environment and launch configuration.
    const parse = () => parseManagerConfig({ ...input, controlPlane }, validPoolId())

    // Then: the duplicated source of truth is rejected.
    expect(parse).toThrow()
  })

  it("accepts alternate public domains without embedding deployment policy", () => {
    // Given: a reusable product deployment with two different public DNS names.
    const input = {
      ...validManagerConfigInput(),
      publicEndpoints: [
        {
          host: "candidate.browser.example.org",
          origin: "https://candidate.browser.example.org",
          role: "CANDIDATE",
        },
        {
          host: "browser.example.org",
          origin: "https://browser.example.org",
          role: "PRODUCTION",
        },
      ],
    }

    // When: the manager parses the role-bound public endpoints.
    const config = parseManagerConfig(input, validPoolId())

    // Then: the product layer accepts safe domains without knowing the deployment's real names.
    expect(config.controlPlane.allowedHosts).toEqual([
      "candidate.browser.example.org",
      "browser.example.org",
    ])
  })

  it.each([
    { host: "127.0.0.1", origin: "https://127.0.0.1", role: "CANDIDATE" },
    { host: "candidate.example.com", origin: "https://candidate.example.com:443", role: "CANDIDATE" },
    { host: "candidate.example.com", origin: "https://candidate.example.com/path", role: "CANDIDATE" },
  ])("rejects an unsafe public endpoint: $origin", (endpoint) => {
    // Given: one endpoint that is not an exact public host-only HTTPS origin.
    const valid = validManagerConfigInput()
    const input = { ...valid, publicEndpoints: [endpoint, valid.publicEndpoints[1]] }

    // When: startup validates the public boundary.
    const parse = () => parseManagerConfig(input, validPoolId())

    // Then: no listener starts for an unsafe endpoint.
    expect(parse).toThrow()
  })
})
