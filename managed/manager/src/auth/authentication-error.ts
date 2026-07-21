export const AuthenticationFailure = {
  INVALID_CLAIMS: "INVALID_CLAIMS",
  INVALID_HEADER: "INVALID_HEADER",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  JWKS_RATE_LIMITED: "JWKS_RATE_LIMITED",
  JWKS_UNAVAILABLE: "JWKS_UNAVAILABLE",
  MALFORMED_TOKEN: "MALFORMED_TOKEN",
  MISSING_TOKEN: "MISSING_TOKEN",
  UNKNOWN_KID: "UNKNOWN_KID",
} as const
export type AuthenticationFailure =
  (typeof AuthenticationFailure)[keyof typeof AuthenticationFailure]

export class AuthenticationError extends Error {
  public override readonly name = "AuthenticationError"

  public constructor(
    public readonly code: AuthenticationFailure,
    options?: ErrorOptions,
  ) {
    super("authentication rejected", options)
  }
}
