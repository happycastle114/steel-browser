import {
  CONTROL_PLANE_API_VERSION,
  MANAGED_ERROR_CODE,
  ManagedErrorEnvelopeSchema,
  PrincipalIdSchema,
  PrincipalRoleSchema,
  Sha256Schema,
  type Uuid,
} from "@happycastle/steel-managed-shared";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { ManagedOperationsError } from "./errors.js";
import type { ManagedPrincipal } from "./port.js";

export const ManagedPrincipalSchema = z
  .object({
    principalDigest: Sha256Schema,
    principalId: PrincipalIdSchema,
    role: PrincipalRoleSchema,
  })
  .strict();

export type ManagedResponseInput = Readonly<{
  action: () => Promise<unknown>;
  nextRequestId: () => Uuid;
  reply: FastifyReply;
  status: 200 | 202;
}>;

export async function sendManagedResponse(input: ManagedResponseInput) {
  try {
    const body = await input.action();
    return input.reply
      .header("X-Managed-Api-Version", CONTROL_PLANE_API_VERSION)
      .code(input.status)
      .send(body);
  } catch (error) {
    const managed =
      error instanceof ManagedOperationsError
        ? error
        : new ManagedOperationsError({
            code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
            message: "Managed operation failed",
          });
    const envelope = ManagedErrorEnvelopeSchema.parse({
      apiVersion: CONTROL_PLANE_API_VERSION,
      error: {
        code: managed.code,
        message: managed.message,
        retryable: managed.retryable,
        requestId: input.nextRequestId(),
        ...(managed.details === undefined ? {} : { details: managed.details }),
      },
    });
    if (managed.retryAfterSeconds !== undefined)
      input.reply.header("Retry-After", managed.retryAfterSeconds);
    return input.reply
      .header("X-Managed-Api-Version", CONTROL_PLANE_API_VERSION)
      .code(managed.status)
      .send(envelope);
  }
}

export function parseInput<Output, Definition extends z.ZodTypeDef, Input>(
  schema: z.ZodType<Output, Definition, Input>,
  value: unknown,
): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ManagedOperationsError({
      code: MANAGED_ERROR_CODE.INVALID_ARGUMENT,
      message: "Invalid managed request",
    });
  }
  return parsed.data;
}

export function parseOutput<Output, Definition extends z.ZodTypeDef, Input>(
  schema: z.ZodType<Output, Definition, Input>,
  value: unknown,
): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ManagedOperationsError({
      code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
      message: "Managed domain response failed validation",
    });
  }
  return parsed.data;
}

export function parsePrincipal(value: ManagedPrincipal): ManagedPrincipal {
  return parseOutput(ManagedPrincipalSchema, value);
}
