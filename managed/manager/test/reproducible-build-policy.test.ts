import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  MANAGER_REPRODUCIBLE_BUILD_BOUNDARY,
  verifyManagerReproducibleBuildScript,
} from "../src/image/reproducible-build-policy.js"

const scriptPath = fileURLToPath(new URL("../image/build-reproducible.sh", import.meta.url))

describe("manager reproducible image build", () => {
  it("binds two registry-read builds to the production audit receipt", () => {
    const source = readFileSync(scriptPath, "utf8")

    expect(() => verifyManagerReproducibleBuildScript(source)).not.toThrow()
  })

  it("rejects every release boundary mutation", () => {
    const source = readFileSync(scriptPath, "utf8")

    for (const boundary of Object.values(MANAGER_REPRODUCIBLE_BUILD_BOUNDARY)) {
      const mutated = source.replace(boundary, "release-boundary-removed")
      expect(mutated).not.toBe(source)
      expect(() => verifyManagerReproducibleBuildScript(mutated)).toThrow()
    }
  })
})
