import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
import { z } from "zod"

const PRODUCTION_ROOT = "/app"
const PRODUCTION_MANIFEST = "/app/managed/runtime-source-manifest.json"
const PACKAGE_LOCK_PATH = "package-lock.json" as const
const SOURCE_ROOTS = [
  "api/build",
  "api/extensions/recorder/dist",
  "managed/shared/build",
  "managed/worker/build",
  "ui/dist",
] as const
const SOURCE_FILES = [
  "api/extensions/recorder/icon.png",
  "api/extensions/recorder/manifest.json",
  "api/extensions/recorder/package-lock.json",
  "api/extensions/recorder/package.json",
  "api/package.json",
  "managed/shared/package.json",
  "managed/worker/package.json",
  PACKAGE_LOCK_PATH,
  "package.json",
  "ui/package.json",
] as const

const RuntimeSourceFileSchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .readonly()

const RuntimeSourceManifestSchema = z
  .object({
    files: z.array(RuntimeSourceFileSchema).min(1).readonly(),
    packageLockSha256: z.string().regex(/^[0-9a-f]{64}$/),
    schemaVersion: z.literal(1),
    sourceDateEpoch: z.string().regex(/^[1-9][0-9]*$/),
    sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .strict()
  .readonly()

export type RuntimeSourceReceipt = {
  readonly fileCount: number
  readonly packageLockSha256: string
  readonly sourceDateEpoch: string
  readonly sourceRevision: string
}

async function discoverFiles(root: string, sourcePath: string): Promise<string[]> {
  const absolute = resolve(root, sourcePath)
  const metadata = await stat(absolute)
  if (metadata.isFile()) {
    return [sourcePath]
  }
  const entries = await readdir(absolute, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => discoverFiles(root, join(sourcePath, entry.name))),
  )
  return nested.flat()
}

function assertContainedPath(root: string, sourcePath: string): string {
  const absolute = resolve(root, sourcePath)
  const relation = relative(root, absolute)
  if (relation.startsWith("..") || relation.length === 0) {
    throw new TypeError("runtime source manifest contains an unsafe path")
  }
  return absolute
}

async function digestFile(root: string, sourcePath: string): Promise<{
  readonly bytes: number
  readonly path: string
  readonly sha256: string
}> {
  const bytes = await readFile(assertContainedPath(root, sourcePath))
  return {
    bytes: bytes.byteLength,
    path: sourcePath.split(sep).join("/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

export async function verifyRuntimeSourceManifest(
  root = PRODUCTION_ROOT,
  manifestPath = PRODUCTION_MANIFEST,
): Promise<RuntimeSourceReceipt> {
  const serialized = await readFile(manifestPath, "utf8")
  const manifest = RuntimeSourceManifestSchema.parse(JSON.parse(serialized))
  const discovered = await Promise.all(
    [...SOURCE_FILES, ...SOURCE_ROOTS].map((sourcePath) =>
      discoverFiles(root, sourcePath),
    ),
  )
  const paths = [...new Set(discovered.flat())].sort()
  const actual = await Promise.all(paths.map((path) => digestFile(root, path)))
  const expected = [...manifest.files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError("runtime source files do not match the immutable manifest")
  }
  const packageLock = actual.find((file) => file.path === PACKAGE_LOCK_PATH)
  if (packageLock?.sha256 !== manifest.packageLockSha256) {
    throw new TypeError("runtime package lock does not match the immutable manifest")
  }
  return {
    fileCount: actual.length,
    packageLockSha256: manifest.packageLockSha256,
    sourceDateEpoch: manifest.sourceDateEpoch,
    sourceRevision: manifest.sourceRevision,
  }
}
