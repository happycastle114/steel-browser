import { createHash } from "node:crypto"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

export const UI_ASSET_MANIFEST_NAME = "asset-manifest.json"
const MANIFEST_BYTES_MAX = 1_048_576
const FORBIDDEN_ASSET_SEGMENTS = new Set(["_showcase", "fixture", "fixtures", "test", "tests"])
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const AssetPathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
  .refine((value) => !value.split("/").some((segment) => segment === "." || segment === ".."))
  .refine((value) => !value.split("/").some((segment) => FORBIDDEN_ASSET_SEGMENTS.has(segment)))
  .refine((value) => !value.endsWith(".map"))
const AssetSchema = z
  .object({ bytes: z.number().int().nonnegative().safe(), path: AssetPathSchema, sha256: Sha256Schema })
  .strict()
  .readonly()
export const UiAssetManifestSchema = z
  .object({ files: z.array(AssetSchema).min(1).max(2_048), schemaVersion: z.literal(1), treeSha256: Sha256Schema })
  .strict()
  .superRefine((manifest, context) => {
    const paths = manifest.files.map((file) => file.path)
    if (
      new Set(paths).size !== paths.length ||
      paths.some((value, index) => {
        const previous = paths[index - 1]
        return previous !== undefined && previous >= value
      })
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "asset paths must be unique and sorted" })
    }
    if (treeDigest(manifest.files) !== manifest.treeSha256) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "asset tree digest mismatched" })
    }
  })
  .readonly()
export type UiAssetManifest = z.infer<typeof UiAssetManifestSchema>

export async function buildUiAssetManifest(root: string): Promise<UiAssetManifest> {
  const files = await listFiles(root)
  const records = await Promise.all(
    files.map(async (relativePath) => {
      const bytes = await readFile(path.join(root, relativePath))
      return { bytes: bytes.byteLength, path: relativePath, sha256: sha256(bytes) }
    }),
  )
  return UiAssetManifestSchema.parse({
    files: records,
    schemaVersion: 1,
    treeSha256: treeDigest(records),
  })
}

export async function writeUiAssetManifest(root: string): Promise<UiAssetManifest> {
  const manifest = await buildUiAssetManifest(root)
  await writeFile(
    path.join(root, UI_ASSET_MANIFEST_NAME),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o444 },
  )
  return manifest
}

export async function loadVerifiedUiAssetManifest(root: string): Promise<UiAssetManifest> {
  const manifestPath = path.join(root, UI_ASSET_MANIFEST_NAME)
  const metadata = await stat(manifestPath)
  if (!metadata.isFile() || metadata.size > MANIFEST_BYTES_MAX) {
    throw new TypeError("UI asset manifest rejected")
  }
  const declared = UiAssetManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")))
  const observed = await buildUiAssetManifest(root)
  if (JSON.stringify(declared) !== JSON.stringify(observed)) {
    throw new TypeError("UI asset readback mismatched")
  }
  if (!declared.files.some((file) => file.path === "index.html")) {
    throw new TypeError("UI entrypoint missing")
  }
  return declared
}

async function listFiles(root: string): Promise<readonly string[]> {
  const rootMetadata = await stat(root)
  if (!rootMetadata.isDirectory()) throw new TypeError("UI asset root must be a directory")
  const pending = [""]
  const files: string[] = []
  while (pending.length > 0) {
    const relativeDirectory = pending.pop()
    if (relativeDirectory === undefined) break
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      if (entry.isSymbolicLink()) throw new TypeError("UI asset symlink rejected")
      if (entry.isDirectory()) pending.push(relativePath)
      else if (entry.isFile() && relativePath !== UI_ASSET_MANIFEST_NAME) files.push(relativePath)
      else if (!entry.isFile()) throw new TypeError("UI asset file type rejected")
    }
  }
  return files.sort()
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function treeDigest(files: readonly z.infer<typeof AssetSchema>[]): string {
  return sha256(Buffer.from(JSON.stringify(files), "utf8"))
}
