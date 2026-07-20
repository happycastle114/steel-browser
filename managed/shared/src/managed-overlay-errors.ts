import { OVERLAY_ERROR_CODE } from "./managed-overlay-catalog.js"

export type OverlayErrorCode = (typeof OVERLAY_ERROR_CODE)[keyof typeof OVERLAY_ERROR_CODE]

export class ManagedOverlayVerificationError extends Error {
  override readonly name = "ManagedOverlayVerificationError"

  constructor(readonly code: OverlayErrorCode, readonly detail: string, options?: ErrorOptions) {
    super(`${code}: ${detail}`, options)
  }
}

export function overlayFailure(code: OverlayErrorCode, detail: string, options?: ErrorOptions): never {
  throw new ManagedOverlayVerificationError(code, detail, options)
}
