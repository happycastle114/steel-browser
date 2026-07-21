import { randomUUID } from "node:crypto"
import {
  CONTROL_PLANE_SESSION_ID_MODE,
  CreateIdempotencyKeySchema,
  MANAGED_CREATE_HEADER,
  ManagedCreateHeaderValuesSchema,
  PRINCIPAL_KIND,
  buildRandomCreateToken,
  deriveCreateCorrelation,
  parseCreateTokenKey,
  type CreateIdempotencyKey,
  type ManagedCreateHeaderValues,
  type ManagerInstanceId,
  type PoolId,
  type PrincipalId,
  type PrincipalKind,
  type SessionId,
} from "@happycastle/steel-managed-shared"
import type { CreateTokenKeyMaterial } from "../secret/create-token-key.js"

type ManagedCreateHeadersOptions = Readonly<{
  key: CreateTokenKeyMaterial
  managerInstanceId: ManagerInstanceId
  poolId: PoolId
}>

type KeyedCreateInput = Readonly<{
  idempotencyKey: CreateIdempotencyKey
  principalId: PrincipalId
  sessionId: SessionId
}>

export class ManagedCreateHeaders {
  public constructor(private readonly options: ManagedCreateHeadersOptions) {}

  public async keyed(input: KeyedCreateInput): Promise<ManagedCreateHeaderValues> {
    const correlation = await this.correlate(
      input.principalId,
      input.idempotencyKey,
      input.sessionId,
    )
    return this.headers({
      ownerSha256: correlation.ownerSha256,
      requestSha256: correlation.requestSha256,
      token: correlation.createToken,
    })
  }

  public async compatibility(
    principalId: PrincipalId,
    sessionId: SessionId,
  ): Promise<ManagedCreateHeaderValues> {
    const tokenUuid = randomUUID()
    const correlation = await this.correlate(
      principalId,
      CreateIdempotencyKeySchema.parse(`compat:${tokenUuid}`),
      sessionId,
    )
    return this.headers({
      ownerSha256: correlation.ownerSha256,
      requestSha256: correlation.requestSha256,
      token: buildRandomCreateToken(tokenUuid),
    })
  }

  private async correlate(
    principalId: PrincipalId,
    idempotencyKey: CreateIdempotencyKey,
    sessionId: SessionId,
  ) {
    return await this.options.key.withBytes(async (source) => {
      const encoded = Buffer.from(source)
      let key: ReturnType<typeof parseCreateTokenKey> | undefined
      try {
        key = parseCreateTokenKey(encoded.toString("hex"))
        return await deriveCreateCorrelation({
          idempotencyKey,
          key,
          principalId,
          principalKind: principalKind(principalId),
          requestBody: { sessionId },
          sessionIdMode: CONTROL_PLANE_SESSION_ID_MODE.CLIENT_SUPPLIED,
        })
      } finally {
        encoded.fill(0)
        key?.fill(0)
      }
    })
  }

  private headers(input: Readonly<{
    ownerSha256: string
    requestSha256: string
    token: string
  }>): ManagedCreateHeaderValues {
    return ManagedCreateHeaderValuesSchema.parse({
      [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: this.options.managerInstanceId,
      [MANAGED_CREATE_HEADER.OWNER_SHA256]: input.ownerSha256,
      [MANAGED_CREATE_HEADER.POOL_ID]: this.options.poolId,
      [MANAGED_CREATE_HEADER.REQUEST_SHA256]: input.requestSha256,
      [MANAGED_CREATE_HEADER.TOKEN]: input.token,
    })
  }
}

function principalKind(principalId: PrincipalId): PrincipalKind {
  for (const kind of Object.values(PRINCIPAL_KIND)) {
    if (principalId.startsWith(`${kind}:`)) return kind
  }
  throw new TypeError("principal kind prefix is invalid")
}
