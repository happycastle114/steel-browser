import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { TextDecoder } from "node:util"

const RELEASE_EVIDENCE_BYTES_MAX = 65_536
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

export const ReleaseEvidenceMode = {
  CONFIG_FILE: "CONFIG_FILE",
} as const
export type ReleaseEvidenceMode =
  (typeof ReleaseEvidenceMode)[keyof typeof ReleaseEvidenceMode]

export const ReleaseEvidenceFailure = {
  CONTENT: "CONTENT",
  FILE: "FILE",
  HASH: "HASH",
  METADATA: "METADATA",
  SCHEMA: "SCHEMA",
} as const
type ReleaseEvidenceFailure =
  (typeof ReleaseEvidenceFailure)[keyof typeof ReleaseEvidenceFailure]

export class ReleaseEvidenceError extends Error {
  public override readonly name = "ReleaseEvidenceError"

  public constructor(public readonly code: ReleaseEvidenceFailure) {
    super("release evidence rejected")
  }
}

export type ReleaseEvidenceSchema<Output> = Readonly<{
  parse(input: unknown): Output
}>

export type ReleaseEvidenceFileOptions<Output> = Readonly<{
  expectedGid: number
  expectedSha256: string
  expectedUid: number
  path: string
  schema: ReleaseEvidenceSchema<Output>
}>

export type VerifiedReleaseEvidence<Output> = Readonly<{
  evidence: Output
  mode: typeof ReleaseEvidenceMode.CONFIG_FILE
  sha256: string
}>

export async function loadVerifiedReleaseEvidenceFile<Output>(
  options: ReleaseEvidenceFileOptions<Output>,
): Promise<VerifiedReleaseEvidence<Output>> {
  try {
    if (!SHA256_PATTERN.test(options.expectedSha256)) {
      throw new ReleaseEvidenceError(ReleaseEvidenceFailure.HASH)
    }
    const pathMetadata = await lstat(options.path)
    if (pathMetadata.isSymbolicLink()) {
      throw new ReleaseEvidenceError(ReleaseEvidenceFailure.FILE)
    }
    const handle = await open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await handle.stat()
      if (
        !metadata.isFile() ||
        metadata.uid !== options.expectedUid ||
        metadata.gid !== options.expectedGid ||
        (metadata.mode & 0o777) !== 0o400 ||
        metadata.size < 1 ||
        metadata.size > RELEASE_EVIDENCE_BYTES_MAX
      ) {
        throw new ReleaseEvidenceError(ReleaseEvidenceFailure.METADATA)
      }
      const bytes = Buffer.alloc(metadata.size + 1)
      let bytesRead = 0
      while (bytesRead < bytes.byteLength) {
        const result = await handle.read(
          bytes,
          bytesRead,
          bytes.byteLength - bytesRead,
          bytesRead,
        )
        if (result.bytesRead === 0) break
        bytesRead += result.bytesRead
      }
      if (bytesRead !== metadata.size) {
        throw new ReleaseEvidenceError(ReleaseEvidenceFailure.CONTENT)
      }
      const exact = bytes.subarray(0, bytesRead)
      const sha256 = createHash("sha256").update(exact).digest("hex")
      if (sha256 !== options.expectedSha256) {
        throw new ReleaseEvidenceError(ReleaseEvidenceFailure.HASH)
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(exact))
      } catch {
        throw new ReleaseEvidenceError(ReleaseEvidenceFailure.CONTENT)
      }
      try {
        return Object.freeze({
          evidence: options.schema.parse(decoded),
          mode: ReleaseEvidenceMode.CONFIG_FILE,
          sha256,
        })
      } catch (error) {
        if (error instanceof ReleaseEvidenceError) throw error
        throw new ReleaseEvidenceError(ReleaseEvidenceFailure.SCHEMA)
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof ReleaseEvidenceError) throw error
    throw new ReleaseEvidenceError(ReleaseEvidenceFailure.FILE)
  }
}
