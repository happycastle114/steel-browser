import { createHash } from "node:crypto"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

const sourceRevision = process.env.MANAGED_SOURCE_REVISION
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH
const outputPath = process.argv[2]
if (!/^[0-9a-f]{40}$/u.test(sourceRevision ?? "")) throw new TypeError("source revision rejected")
if (!/^(?:0|[1-9][0-9]*)$/u.test(sourceDateEpoch ?? "")) throw new TypeError("source epoch rejected")
if (outputPath === undefined || process.argv.length !== 3) throw new TypeError("output path rejected")

const roots = [
  "package-lock.json",
  "package.json",
  "managed/console/dist",
  "managed/gateway/package.json",
  "managed/gateway/src",
  "managed/manager/image",
  "managed/manager/init/Cargo.lock",
  "managed/manager/init/Cargo.toml",
  "managed/manager/init/src",
  "managed/manager/package.json",
  "managed/manager/src",
  "managed/shared/package.json",
  "managed/shared/src",
]
const paths = (await Promise.all(roots.map(listFiles))).flat().sort()
const files = await Promise.all(
  paths.map(async (filePath) => {
    const bytes = await readFile(filePath)
    return { bytes: bytes.byteLength, path: filePath, sha256: sha256(bytes) }
  }),
)
const manifest = {
  files,
  schemaVersion: 1,
  sourceDateEpoch,
  sourceRevision,
  treeSha256: sha256(Buffer.from(JSON.stringify(files), "utf8")),
}
await writeFile(outputPath, `${JSON.stringify(manifest, undefined, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o444,
})

async function listFiles(selectedPath) {
  const metadata = await stat(selectedPath)
  if (metadata.isFile()) return [selectedPath]
  if (!metadata.isDirectory()) throw new TypeError("runtime source type rejected")
  const entries = await readdir(selectedPath, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        if (entry.isSymbolicLink()) throw new TypeError("runtime source symlink rejected")
        return listFiles(path.join(selectedPath, entry.name))
      }),
    )
  ).flat()
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
