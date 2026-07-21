import {
  MANAGED_ERROR_CATALOG,
  ManagedErrorEnvelopeSchema,
} from "@happycastle/steel-managed-shared/ai-client"

export type ManagedAiErrorEnvelope = ReturnType<typeof ManagedErrorEnvelopeSchema.parse>

export class AiClientApiError extends Error {
  public override readonly name = "AiClientApiError"

  public constructor(
    public readonly status: number,
    public readonly envelope: ManagedAiErrorEnvelope,
  ) {
    super(envelope.error.message)
  }
}

export class AiClientProtocolError extends Error {
  public override readonly name = "AiClientProtocolError"
}

export async function throwApiOrProtocolError(
  status: number,
  payload: unknown,
): Promise<never> {
  const parsed = ManagedErrorEnvelopeSchema.safeParse(payload)
  if (parsed.success && MANAGED_ERROR_CATALOG[parsed.data.error.code].status === status) {
    throw new AiClientApiError(status, parsed.data)
  }
  throw new AiClientProtocolError("Managed AI API returned an invalid error response")
}
