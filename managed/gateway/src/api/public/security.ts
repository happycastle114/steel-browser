import { isIP } from "node:net"
import { z } from "zod"
import { PublicOriginSchema, type PublicOrigin } from "./schemas.js"

export class AccessAuthenticationError extends Error {
  public override readonly name = "AccessAuthenticationError"
}
export class PublicHostError extends Error {
  public override readonly name = "PublicHostError"
}
export class PublicOriginError extends Error {
  public override readonly name = "PublicOriginError"
}

type SecurityOptions = {
  readonly allowedOrigins: readonly string[]
  readonly originByHost: Readonly<Record<string, string>>
  readonly authenticate: (headers: Readonly<Record<string, string | undefined>>) => Promise<void>
}

const SecurityConfigurationSchema = z
  .object({
    allowedOrigins: z.array(PublicOriginSchema).readonly(),
    originByHost: z.record(PublicOriginSchema).readonly(),
  })
  .strict()
  .readonly()

export class PublicRequestSecurity {
  private readonly allowedOrigins: ReadonlySet<string>
  private readonly authenticate: SecurityOptions["authenticate"]
  private readonly originByHost: ReadonlyMap<string, PublicOrigin>

  public constructor(input: SecurityOptions) {
    const configuration = SecurityConfigurationSchema.parse({
      allowedOrigins: input.allowedOrigins,
      originByHost: input.originByHost,
    })
    this.allowedOrigins = new Set(configuration.allowedOrigins)
    this.authenticate = input.authenticate
    const entries = Object.entries(configuration.originByHost).map(([host, origin]) => {
      const normalized = normalizeHost(host)
      if (normalized === undefined || normalized !== normalizeHost(new URL(origin).host)) {
        throw new TypeError("public origin host configuration mismatched")
      }
      return [normalized, origin] as const
    })
    if (new Set(entries.map(([host]) => host)).size !== entries.length) {
      throw new TypeError("public origin hosts must be unique after normalization")
    }
    this.originByHost = new Map(entries)
  }

  public async authorize(input: {
    readonly headers: Readonly<Record<string, string | undefined>>
  }): Promise<{ readonly publicOrigin: PublicOrigin }> {
    const host = normalizeHost(input.headers["host"])
    const publicOrigin = host === undefined ? undefined : this.originByHost.get(host)
    if (publicOrigin === undefined) throw new PublicHostError("public host is not allowed")
    await this.authenticate(input.headers)
    const origin = input.headers["origin"]
    if (origin !== undefined && !this.allowedOrigins.has(origin)) {
      throw new PublicOriginError("browser origin is not allowed")
    }
    return { publicOrigin }
  }
}

function normalizeHost(rawHost: string | undefined): string | undefined {
  if (
    rawHost === undefined ||
    rawHost.length === 0 ||
    /[\s,/@\\]/u.test(rawHost)
  ) {
    return undefined
  }
  try {
    const parsed = new URL(`https://${rawHost}`)
    if (isIP(parsed.hostname) !== 0 || !parsed.hostname.includes(".")) return undefined
    const port = parsed.port === "443" || parsed.port.length === 0 ? "" : `:${parsed.port}`
    return `${parsed.hostname.toLowerCase()}${port}`
  } catch {
    return undefined
  }
}
