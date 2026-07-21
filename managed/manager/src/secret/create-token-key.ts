import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"

export const MANAGER_RUNTIME_GID = 10_001
export const MANAGER_RUNTIME_UID = 10_001
const ENCODED_KEY_BYTES = 64
const DECODED_KEY_BYTES = 32

export const CreateTokenKeyFailure = {
  CONTENT: "CONTENT",
  DESTROYED: "DESTROYED",
  FILE: "FILE",
  METADATA: "METADATA",
} as const
type CreateTokenKeyFailure =
  (typeof CreateTokenKeyFailure)[keyof typeof CreateTokenKeyFailure]

export class CreateTokenKeyError extends Error {
  public override readonly name = "CreateTokenKeyError"

  public constructor(public readonly code: CreateTokenKeyFailure) {
    super("create-token key rejected")
  }
}

export class CreateTokenKeyMaterial {
  private active = true

  public constructor(private readonly key: Buffer) {}

  public withBytes<T>(operation: (key: Uint8Array) => T): T {
    if (!this.active) throw new CreateTokenKeyError(CreateTokenKeyFailure.DESTROYED)
    return operation(this.key)
  }

  public destroy(): boolean {
    if (!this.active) return false
    this.active = false
    this.key.fill(0)
    return true
  }
}

type CreateTokenKeyFileOptions = Readonly<{
  expectedGid: number
  expectedUid: number
  path: string
}>

export async function loadCreateTokenKeyFile(
  options: CreateTokenKeyFileOptions,
): Promise<CreateTokenKeyMaterial> {
  try {
    const pathMetadata = await lstat(options.path)
    if (pathMetadata.isSymbolicLink()) throw new CreateTokenKeyError(CreateTokenKeyFailure.FILE)
    const handle = await open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await handle.stat()
      if (
        !metadata.isFile() ||
        metadata.uid !== options.expectedUid ||
        metadata.gid !== options.expectedGid ||
        (metadata.mode & 0o777) !== 0o400 ||
        metadata.size !== ENCODED_KEY_BYTES
      ) {
        throw new CreateTokenKeyError(CreateTokenKeyFailure.METADATA)
      }
      const encoded = Buffer.alloc(ENCODED_KEY_BYTES + 1)
      try {
        const { bytesRead } = await handle.read(encoded, 0, encoded.byteLength, 0)
        if (bytesRead !== ENCODED_KEY_BYTES) {
          throw new CreateTokenKeyError(CreateTokenKeyFailure.CONTENT)
        }
        return new CreateTokenKeyMaterial(decodeLowercaseHex(encoded.subarray(0, bytesRead)))
      } finally {
        encoded.fill(0)
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof CreateTokenKeyError) throw error
    throw new CreateTokenKeyError(CreateTokenKeyFailure.FILE)
  }
}

function decodeLowercaseHex(encoded: Uint8Array): Buffer {
  if (encoded.byteLength !== ENCODED_KEY_BYTES) {
    throw new CreateTokenKeyError(CreateTokenKeyFailure.CONTENT)
  }
  const decoded = Buffer.alloc(DECODED_KEY_BYTES)
  try {
    for (let index = 0; index < decoded.byteLength; index += 1) {
      const high = hexNibble(encoded[index * 2])
      const low = hexNibble(encoded[index * 2 + 1])
      decoded[index] = high * 16 + low
    }
    return decoded
  } catch (error) {
    decoded.fill(0)
    throw error
  }
}

function hexNibble(value: number | undefined): number {
  if (value !== undefined && value >= 48 && value <= 57) return value - 48
  if (value !== undefined && value >= 97 && value <= 102) return value - 87
  throw new CreateTokenKeyError(CreateTokenKeyFailure.CONTENT)
}
