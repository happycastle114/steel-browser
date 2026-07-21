import {
  selectPublicOrigin,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"
import type {
  AuthenticatedPrincipal,
  AuthenticationHeaders,
} from "../auth/jwt-authenticator.js"

export const RequestBoundaryFailure = {
  HOST_REJECTED: "HOST_REJECTED",
  ORIGIN_REJECTED: "ORIGIN_REJECTED",
} as const
type RequestBoundaryFailure =
  (typeof RequestBoundaryFailure)[keyof typeof RequestBoundaryFailure]

export class RequestBoundaryError extends Error {
  public override readonly name = "RequestBoundaryError"

  public constructor(public readonly code: RequestBoundaryFailure) {
    super("request boundary rejected")
  }
}

type RequestSecurityOptions = {
  readonly authenticate: (headers: AuthenticationHeaders) => Promise<AuthenticatedPrincipal>
  readonly originByHost: Readonly<Record<string, string>>
}

export type AuthorizedRequestContext = {
  readonly principal: AuthenticatedPrincipal
  readonly publicOrigin: SelectedPublicOrigin
}

export class RequestSecurity {
  public constructor(private readonly options: RequestSecurityOptions) {}

  public async authorize(headers: AuthenticationHeaders): Promise<AuthorizedRequestContext> {
    const host = singleHeader(headers, "host")
    let publicOrigin: SelectedPublicOrigin
    try {
      publicOrigin = selectPublicOrigin(host ?? "", this.options.originByHost)
    } catch (error) {
      if (error instanceof TypeError) {
        throw new RequestBoundaryError(RequestBoundaryFailure.HOST_REJECTED)
      }
      throw error
    }
    const principal = await this.options.authenticate(headers)
    const origin = singleHeader(headers, "origin")
    if (origin === null || (origin !== undefined && origin !== publicOrigin)) {
      throw new RequestBoundaryError(RequestBoundaryFailure.ORIGIN_REJECTED)
    }
    return { principal, publicOrigin }
  }
}

function singleHeader(
  headers: AuthenticationHeaders,
  selectedName: string,
): string | null | undefined {
  const matching = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === selectedName,
  )
  if (matching.length === 0) return undefined
  if (matching.length !== 1) return null
  const value = matching[0]?.[1]
  return typeof value === "string" && value.length > 0 ? value : null
}
