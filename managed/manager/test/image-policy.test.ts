import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  MANAGED_MANAGER_IMAGE_POLICY,
  parseManagedManagerImagePolicy,
  parseManagerBaseImageReceipt,
  parseManagerSourceReceipt,
} from "../src/image/image-policy.js"

const sourcePath = fileURLToPath(new URL("../image/SOURCE.json", import.meta.url))
const baseImagesPath = fileURLToPath(new URL("../image/base-images.lock.json", import.meta.url))

describe("managed manager immutable image policy", () => {
  it("accepts the canonical root-init to non-root shellless runtime contract", () => {
    expect(parseManagedManagerImagePolicy(MANAGED_MANAGER_IMAGE_POLICY)).toEqual(
      MANAGED_MANAGER_IMAGE_POLICY,
    )
  })

  it.each([
    { browserIncluded: true },
    { dockerSocket: true },
    { gitIncluded: true },
    { initUid: 10_001 },
    { persistentStorage: true },
    { privileged: true },
    { publicPort: 9_223 },
    { readOnlyRootFileSystem: false },
    { runtimeUid: 0 },
  ])("rejects a manager image policy mutation", (mutation) => {
    expect(() =>
      parseManagedManagerImagePolicy({ ...MANAGED_MANAGER_IMAGE_POLICY, ...mutation }),
    ).toThrow()
  })

  it("verifies the embedded source and exact base-image registry receipts", () => {
    const source = parseManagerSourceReceipt(JSON.parse(readFileSync(sourcePath, "utf8")))
    const bases = parseManagerBaseImageReceipt(JSON.parse(readFileSync(baseImagesPath, "utf8")))

    expect(source.build).toEqual({
      auditReceiptProof: "OCI_LABEL_AND_RUNTIME_SHA256",
      method: "GIT_ARCHIVE_TWO_ATTEMPT_REGISTRY_READBACK",
      script: "managed/manager/image/build-reproducible.sh",
    })
    expect(source.console.proof).toBe("STARTUP_SHA256_READBACK")
    expect(source.runtime.productionAuditReceipt).toBe(
      "/app/managed/production-dependency-audit.json",
    )
    expect(bases.images.nodeRuntime.reference).toBe(MANAGED_MANAGER_IMAGE_POLICY.nodeRuntime)
  })

  it("rejects a syntactically valid platform digest mutation", () => {
    const receipt: unknown = JSON.parse(readFileSync(baseImagesPath, "utf8"))
    const parsed = parseManagerBaseImageReceipt(receipt)
    const mutated = {
      ...parsed,
      images: {
        ...parsed.images,
        nodeRuntime: {
          ...parsed.images.nodeRuntime,
          platforms: {
            ...parsed.images.nodeRuntime.platforms,
            "linux/arm64": `sha256:${"0".repeat(64)}`,
          },
        },
      },
    }

    expect(() => parseManagerBaseImageReceipt(mutated)).toThrow()
  })
})
