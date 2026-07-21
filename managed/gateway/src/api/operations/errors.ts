import {
  MANAGED_ERROR_CODE,
  MANAGED_ERROR_CATALOG,
  type JsonValue,
  type ManagedErrorCode,
} from "@happycastle/steel-managed-shared";

export type ManagedOperationsErrorInput = Readonly<{
  code: ManagedErrorCode;
  message: string;
  details?: JsonValue;
  retryAfterSeconds?: number;
}>;

export class ManagedOperationsConfigurationError extends Error {
  public override readonly name = "ManagedOperationsConfigurationError";
}

export function invalidManagedResourceIdentity(): ManagedOperationsError {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
    message:
      "Managed domain response identity did not match the requested resource",
  });
}

export class ManagedOperationsError extends Error {
  public override readonly name = "ManagedOperationsError";
  public readonly code: ManagedErrorCode;
  public readonly details?: JsonValue;
  public readonly retryAfterSeconds?: number;
  public readonly retryable: boolean;
  public readonly status: number;

  public constructor(input: ManagedOperationsErrorInput) {
    super(input.message);
    const catalog = MANAGED_ERROR_CATALOG[input.code];
    this.code = input.code;
    this.retryable = catalog.retryable;
    this.status = catalog.status;
    if (input.details !== undefined) this.details = input.details;
    if (input.retryAfterSeconds !== undefined)
      this.retryAfterSeconds = input.retryAfterSeconds;
  }
}
