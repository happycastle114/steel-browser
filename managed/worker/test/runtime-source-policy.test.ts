import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { verifyRuntimeSourceManifest } from "../src/runtime-source-policy.js"

const SOURCE_FILES = [
  "api/build/index.js",
  "api/extensions/recorder/dist/background.js",
  "api/extensions/recorder/icon.png",
  "api/extensions/recorder/manifest.json",
  "api/extensions/recorder/package-lock.json",
  "api/extensions/recorder/package.json",
  "api/package.json",
  "managed/shared/build/index.js",
  "managed/shared/package.json",
  "managed/worker/build/cli.js",
  "managed/worker/package.json",
  "package-lock.json",
  "package.json",
  "ui/dist/index.html",
  "ui/package.json",
] as const

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

async function fixture(): Promise<{
  readonly manifestPath: string
  readonly root: string
}> {
  const root = await mkdtemp(join(tmpdir(), "steel-runtime-source-"))
  temporaryRoots.push(root)
  const files = []
  for (const path of SOURCE_FILES) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    const bytes = Buffer.from(`fixture:${path}`)
    await writeFile(absolute, bytes)
    files.push({
      bytes: bytes.byteLength,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
  }
  const packageLock = files.find((file) => file.path === "package-lock.json")
  if (packageLock === undefined) {
    throw new TypeError("fixture package lock is missing")
  }
  const manifestPath = join(root, "runtime-source-manifest.json")
  await writeFile(
    manifestPath,
    JSON.stringify({
      files,
      packageLockSha256: packageLock.sha256,
      schemaVersion: 1,
      sourceDateEpoch: "1773013379",
      sourceRevision: "a".repeat(40),
    }),
  )
  return { manifestPath, root }
}

describe("runtime source manifest", () => {
  it("binds API UI extension worker and package-lock bytes", async () => {
    // Given
    const source = await fixture()

    // When
    const receipt = await verifyRuntimeSourceManifest(
      source.root,
      source.manifestPath,
    )

    // Then
    expect(receipt.fileCount).toBe(SOURCE_FILES.length)
    expect(receipt.sourceDateEpoch).toBe("1773013379")
    expect(receipt.sourceRevision).toBe("a".repeat(40))
  })

  it("rejects an API build sentinel mutation", async () => {
    // Given
    const source = await fixture()
    await writeFile(join(source.root, "api/build/index.js"), "mutated")

    // When
    const verify = () =>
      verifyRuntimeSourceManifest(source.root, source.manifestPath)

    // Then
    await expect(verify).rejects.toThrow()
  })

  it("rejects an extra unreviewed runtime artifact", async () => {
    // Given
    const source = await fixture()
    await writeFile(join(source.root, "api/build/extra.js"), "extra")

    // When
    const verify = () =>
      verifyRuntimeSourceManifest(source.root, source.manifestPath)

    // Then
    await expect(verify).rejects.toThrow()
  })

  it("rejects a missing shipped runtime artifact", async () => {
    const source = await fixture()
    await unlink(join(source.root, "managed/worker/build/cli.js"))

    await expect(
      verifyRuntimeSourceManifest(source.root, source.manifestPath),
    ).rejects.toThrow()
  })

  it("rejects a package-lock receipt mismatch", async () => {
    // Given
    const source = await fixture()
    const manifest = await readFile(source.manifestPath, "utf8")
    const mutated = manifest.replace(
      /"packageLockSha256":"[0-9a-f]{64}"/,
      `"packageLockSha256":"${"b".repeat(64)}"`,
    )
    await writeFile(source.manifestPath, mutated)

    // When
    const verify = () =>
      verifyRuntimeSourceManifest(source.root, source.manifestPath)

    // Then
    await expect(verify).rejects.toThrow()
  })
})
