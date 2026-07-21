import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  parseSourceDisclosure,
  type SourceDisclosure,
  verifySourceDisclosure,
} from "../src/source-disclosure-policy.js"

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..")
const IMAGE_SOURCES = [
  "managed/worker/image/Dockerfile",
  "managed/worker/image/build-reproducible.sh",
  "managed/worker/image/write-runtime-source-manifest.mjs",
] as const

async function fixture(): Promise<{
  readonly disclosure: SourceDisclosure
  readonly shipped: readonly string[]
}> {
  const names = await readdir(resolve(REPOSITORY_ROOT, "managed/worker/src"))
  const shipped = [
    ...IMAGE_SOURCES,
    ...names
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `managed/worker/src/${name}`),
  ].sort()
  const serialized = await readFile(
    resolve(REPOSITORY_ROOT, "managed/worker/image/SOURCE.json"),
    "utf8",
  )
  return { disclosure: parseSourceDisclosure(JSON.parse(serialized)), shipped }
}

describe("Apache source disclosure", () => {
  it("enumerates every source file copied into the managed worker image", async () => {
    const input = await fixture()
    expect(() => verifySourceDisclosure(input.disclosure, input.shipped)).not.toThrow()
  })

  it("fails when any shipped journal or supervisor source is omitted", async () => {
    const input = await fixture()
    for (const missing of [
      "managed/worker/src/config.ts",
      "managed/worker/src/create-journal-store.ts",
      "managed/worker/src/supervisor-transport.ts",
    ]) {
      const modifications = input.disclosure.modifications.filter(
        (path) => path !== missing,
      )
      expect(() =>
        verifySourceDisclosure({ ...input.disclosure, modifications }, input.shipped),
      ).toThrow()
    }
  })

  it("fails when an undeclared shipped source appears", async () => {
    const input = await fixture()
    expect(() =>
      verifySourceDisclosure(
        input.disclosure,
        [...input.shipped, "managed/worker/src/new-source.ts"],
      ),
    ).toThrow()
  })
})
