import { fileURLToPath } from "node:url"

import { build, type Plugin } from "esbuild"
import { describe, expect, it } from "vitest"

const RUNTIME_ENTRY_PATH = fileURLToPath(new URL("../src/index.ts", import.meta.url))
const FORBIDDEN_RUNTIME_INPUT = /(?:\/(?:raw-state-(?:comparison|evidence|vocabulary-policy)|semantic-typescript-program|sequence-provenance|type-safety-guard|typescript-source-files)\.(?:js|ts)$)/u

function externalizePackages(packageImports: Set<string>): Plugin {
  return {
    name: "externalize-runtime-packages",
    setup(buildContext): void {
      buildContext.onResolve({ filter: /.*/ }, (input) => {
        if (input.path.startsWith(".") || input.path.startsWith("/")) return undefined
        packageImports.add(input.path)
        return { external: true, path: input.path }
      })
    },
  }
}

describe("shared runtime entry", () => {
  it("does not load build-time TypeScript tooling from the production barrel", async () => {
    // Given
    const packageImports = new Set<string>()

    // When
    const result = await build({
      bundle: true,
      entryPoints: [RUNTIME_ENTRY_PATH],
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "node",
      plugins: [externalizePackages(packageImports)],
      write: false,
    })

    // Then
    expect([...packageImports]).not.toContain("typescript")
    expect(Object.keys(result.metafile.inputs).filter(
      (input) => FORBIDDEN_RUNTIME_INPUT.test(input),
    )).toEqual([])
  })
})
