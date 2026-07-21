import { readFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { fileURLToPath } from "node:url"

import { build, type Metafile, type Plugin } from "esbuild"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { z } from "zod"

const PACKAGE_PATH = fileURLToPath(new URL("../package.json", import.meta.url))
const BROWSER_ENTRY_PATH = fileURLToPath(new URL("../src/browser.ts", import.meta.url))
const BROWSER_CONSUMER_PATH = fileURLToPath(new URL("fixtures/browser-consumer.ts", import.meta.url))
const REPOSITORY_PATH = fileURLToPath(new URL("../../..", import.meta.url))
const NODE_BUILTIN_SPECIFIERS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const FORBIDDEN_TRANSITIVE_INPUT = /(?:\/(?:tool-capabilities|semantic-typescript-program|typescript-source-files)\.(?:js|ts)$|node_modules\/(?:fastify|@modelcontextprotocol)\b)/u

const PackageManifestSchema = z.object({ exports: z.record(z.unknown()).optional() }).passthrough()

function rejectNodeBuiltins(imports: Set<string>): Plugin {
  return {
    name: "reject-node-builtins",
    setup(buildContext): void {
      buildContext.onResolve({ filter: /.*/ }, (input) => {
        if (!NODE_BUILTIN_SPECIFIERS.has(input.path)) return undefined
        imports.add(input.path)
        return { errors: [{ text: `browser contract imports ${input.path}` }] }
      })
    },
  }
}

function forbiddenInputs(metafile: Metafile): readonly string[] {
  return Object.keys(metafile.inputs).filter((input) => FORBIDDEN_TRANSITIVE_INPUT.test(input))
}

describe("browser contract entry", () => {
  it("publishes browser and type conditions when consumers import the browser subpath", async () => {
    // Given
    const manifest = PackageManifestSchema.parse(JSON.parse(await readFile(PACKAGE_PATH, "utf8")))

    // When
    const browserExport = manifest.exports?.["./browser"]

    // Then
    expect(browserExport).toEqual({
      types: "./build/browser.d.ts",
      browser: "./build/browser.js",
      import: "./build/browser.js",
    })
  })

  it("bundles without server-only transitive imports when targeting a browser", async () => {
    // Given
    const builtinImports = new Set<string>()

    // When
    const result = await build({
      entryPoints: [BROWSER_ENTRY_PATH],
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      plugins: [rejectNodeBuiltins(builtinImports)],
      write: false,
    })

    // Then
    expect([...builtinImports]).toEqual([])
    expect(forbiddenInputs(result.metafile)).toEqual([])
    expect(result.outputFiles).toHaveLength(1)
    expect(result.outputFiles[0]?.text).not.toMatch(/\bprocess\s*\./u)
  })

  it("resolves and bundles the built package subpath under browser conditions", async () => {
    // Given
    const builtinImports = new Set<string>()

    // When
    const result = await build({
      bundle: true,
      conditions: ["browser", "import"],
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      plugins: [rejectNodeBuiltins(builtinImports)],
      stdin: {
        contents: "import * as contracts from '@happycastle/steel-managed-shared/browser'; globalThis.steelManagedContracts = contracts",
        resolveDir: REPOSITORY_PATH,
        sourcefile: "browser-package-consumer.mjs",
      },
      write: false,
    })

    // Then
    expect([...builtinImports]).toEqual([])
    const browserInputs = Object.keys(result.metafile.inputs).filter((input) => input.includes("browser"))
    expect(browserInputs.some((input) => /(?:^|\/)build\/browser\.js$/u.test(input)),
      browserInputs.join("\n")).toBe(true)
    expect(forbiddenInputs(result.metafile)).toEqual([])
    expect(result.outputFiles[0]?.text).not.toMatch(/\bprocess\s*\./u)
  })

  it("typechecks the operations and AI client surface without consumer Zod imports", () => {
    // Given
    const program = ts.createProgram({
      rootNames: [BROWSER_CONSUMER_PATH],
      options: {
        exactOptionalPropertyTypes: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    })

    // When
    const diagnostics = ts.getPreEmitDiagnostics(program)

    // Then
    expect(diagnostics.map(
      (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    )).toEqual([])
  })
})
