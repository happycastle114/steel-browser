import { createHash } from "node:crypto"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40}$/
const SOURCE_DATE_EPOCH_PATTERN = /^[1-9][0-9]*$/
const SOURCE_ROOTS = [
  "api/build",
  "api/extensions/recorder/dist",
  "managed/shared/build",
  "managed/worker/build",
  "ui/dist",
]
const SOURCE_FILES = [
  "api/extensions/recorder/icon.png",
  "api/extensions/recorder/manifest.json",
  "api/extensions/recorder/package-lock.json",
  "api/extensions/recorder/package.json",
  "api/package.json",
  "managed/shared/package.json",
  "managed/worker/package.json",
  "package-lock.json",
  "package.json",
  "ui/package.json",
]

async function discoverFiles(root, sourcePath) {
  const absolute = resolve(root, sourcePath)
  const metadata = await stat(absolute)
  if (metadata.isFile()) {
    return [sourcePath]
  }
  const entries = await readdir(absolute, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) =>
      discoverFiles(root, join(sourcePath, entry.name)),
    ),
  )
  return nested.flat()
}

async function describeFile(root, sourcePath) {
  const bytes = await readFile(resolve(root, sourcePath))
  return {
    bytes: bytes.byteLength,
    path: sourcePath.split(sep).join("/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

const [outputPath] = process.argv.slice(2)
const sourceRevision = process.env.MANAGED_SOURCE_REVISION
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH
if (
  outputPath === undefined ||
  sourceRevision === undefined ||
  !SOURCE_REVISION_PATTERN.test(sourceRevision) ||
  sourceDateEpoch === undefined ||
  !SOURCE_DATE_EPOCH_PATTERN.test(sourceDateEpoch)
) {
  process.exitCode = 64
} else {
  const root = process.cwd()
  const discovered = await Promise.all(
    [...SOURCE_FILES, ...SOURCE_ROOTS].map((sourcePath) =>
      discoverFiles(root, sourcePath),
    ),
  )
  const paths = [...new Set(discovered.flat())].sort()
  const files = await Promise.all(
    paths.map((sourcePath) => describeFile(root, sourcePath)),
  )
  const packageLock = files.find((file) => file.path === "package-lock.json")
  if (packageLock === undefined) {
    process.exitCode = 65
  } else {
    const manifest = {
      schemaVersion: 1,
      sourceDateEpoch,
      sourceRevision,
      packageLockSha256: packageLock.sha256,
      files,
    }
    const output = resolve(root, outputPath)
    if (relative(root, output).startsWith("..")) {
      process.exitCode = 66
    } else {
      await writeFile(output, `${JSON.stringify(manifest)}\n`, {
        encoding: "utf8",
        mode: 0o644,
      })
    }
  }
}
