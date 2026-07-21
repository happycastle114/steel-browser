import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  REPRODUCIBLE_BUILD_BOUNDARY,
  verifyReproducibleBuildScript,
} from "../src/reproducible-build-policy.js"

const scriptPath = fileURLToPath(
  new URL("../image/build-reproducible.sh", import.meta.url),
)

describe("reproducible worker build policy", () => {
  it("binds one exported production audit receipt into both registry builds", () => {
    const source = readFileSync(scriptPath, "utf8")
    expect(() => verifyReproducibleBuildScript(source)).not.toThrow()
  })

  it.each(Object.values(REPRODUCIBLE_BUILD_BOUNDARY))(
    "rejects a missing boundary: %s",
    (boundary) => {
      const source = readFileSync(scriptPath, "utf8")
      const mutated = source.replace(boundary, "BOUNDARY_REMOVED")
      expect(mutated).not.toBe(source)
      expect(() => verifyReproducibleBuildScript(mutated)).toThrow()
    },
  )
})
