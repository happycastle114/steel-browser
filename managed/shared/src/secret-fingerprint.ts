import { createHash, createHmac } from "node:crypto"

const SECRET_KEY_BYTE_LENGTH = 32
const FINGERPRINT_PREIMAGE = "steel-managed-create-token-key-fingerprint-v1"

export const SECRET_FINGERPRINT_ERROR_CODE = {
  INVALID_KEY_LENGTH: "INVALID_KEY_LENGTH",
} as const

type SecretFingerprintErrorCode =
  (typeof SECRET_FINGERPRINT_ERROR_CODE)[keyof typeof SECRET_FINGERPRINT_ERROR_CODE]

export class SecretFingerprintError extends Error {
  public override readonly name = "SecretFingerprintError"

  public constructor(
    public readonly code: SecretFingerprintErrorCode,
    detail: string,
  ) {
    super(detail)
  }
}

export type SecretFingerprint = Readonly<{
  readonly createTokenKeyId: string
  readonly fingerprintHmacSha256: string
}>

export function computeSecretFingerprint(secretKey: Uint8Array): SecretFingerprint {
  if (secretKey.byteLength !== SECRET_KEY_BYTE_LENGTH) {
    throw new SecretFingerprintError(
      SECRET_FINGERPRINT_ERROR_CODE.INVALID_KEY_LENGTH,
      `create-token key must be ${SECRET_KEY_BYTE_LENGTH} bytes`,
    )
  }
  const workingKey = Buffer.from(secretKey)
  try {
    return {
      createTokenKeyId: createHash("sha256").update(workingKey).digest("hex"),
      fingerprintHmacSha256: createHmac("sha256", workingKey)
        .update(FINGERPRINT_PREIMAGE, "utf8")
        .digest("hex"),
    }
  } finally {
    workingKey.fill(0)
  }
}
