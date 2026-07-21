import { createHash } from "node:crypto";
import {
  CONTROL_PLANE_FIXED,
  MANAGED_ERROR_CODE,
  MANAGER_MODE_TRANSITION,
  Sha256Schema,
  canonicalJson,
  poolSchemaForConfig,
  type ControlPlaneConfig,
  type CreateIdempotencyKey,
  type Pool,
  type PoolDrainRequest,
  type PoolResumeRequest,
  type Sha256,
} from "@happycastle/steel-managed-shared";
import { ManagedOperationsError } from "./errors.js";
import type { ManagedOperationsClock } from "./list-types.js";

export const POOL_MUTATION_KIND = MANAGER_MODE_TRANSITION;
export type PoolMutationKind =
  (typeof POOL_MUTATION_KIND)[keyof typeof POOL_MUTATION_KIND];

export type PoolMutationCoordinatorOptions = Readonly<{
  clock: ManagedOperationsClock;
  config: ControlPlaneConfig;
}>;

export type PoolMutationExecution =
  | Readonly<{
      action: () => Promise<Pool>;
      idempotencyKey: CreateIdempotencyKey;
      kind: typeof POOL_MUTATION_KIND.DRAIN;
      principalDigest: Sha256;
      request: PoolDrainRequest;
    }>
  | Readonly<{
      action: () => Promise<Pool>;
      idempotencyKey: CreateIdempotencyKey;
      kind: typeof POOL_MUTATION_KIND.RESUME;
      principalDigest: Sha256;
      request: PoolResumeRequest;
    }>;

type ReplayRecord = Readonly<{
  expiresAtMs?: number;
  promise: Promise<Pool>;
  requestHash: Sha256;
}>;

export class PoolMutationCoordinator {
  private readonly idempotencyTtlMs: number;
  private readonly poolSchema: ReturnType<typeof poolSchemaForConfig>;
  private readonly records = new Map<string, ReplayRecord>();

  public constructor(private readonly options: PoolMutationCoordinatorOptions) {
    this.idempotencyTtlMs = options.config.idempotencyTtlMs;
    this.poolSchema = poolSchemaForConfig(options.config);
  }

  public parsePool(value: unknown): Pool {
    const parsed = this.poolSchema.safeParse(value);
    if (!parsed.success) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
        message: "Managed domain response failed validation",
      });
    }
    return parsed.data;
  }

  public execute(input: PoolMutationExecution): Promise<Pool> {
    this.pruneExpired();
    const key = canonicalJson({
      key: input.idempotencyKey,
      kind: input.kind,
      principal: input.principalDigest,
    });
    const requestHash = Sha256Schema.parse(
      createHash("sha256")
        .update(canonicalJson(input.request))
        .digest("hex"),
    );
    const existing = this.records.get(key);
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw new ManagedOperationsError({
          code: MANAGED_ERROR_CODE.SESSION_STATE_CONFLICT,
          message:
            "Pool mutation idempotency key conflicts with an earlier request",
        });
      }
      return existing.promise;
    }
    if (this.records.size >= CONTROL_PLANE_FIXED.idempotencyMax) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.MANAGED_IDEMPOTENCY_CAPACITY,
        message: "Pool mutation replay capacity exhausted",
        retryAfterSeconds: 1,
      });
    }
    const promise = Promise.resolve()
      .then(input.action)
      .then((pool) => this.parsePool(pool));
    const record = { promise, requestHash } satisfies ReplayRecord;
    this.records.set(key, record);
    void promise.then(
      () => this.markSettled(key, record),
      () => this.markSettled(key, record),
    );
    return promise;
  }

  private markSettled(key: string, record: ReplayRecord): void {
    if (this.records.get(key) !== record) return;
    this.records.set(key, {
      ...record,
      expiresAtMs: this.options.clock.now() + this.idempotencyTtlMs,
    });
  }

  private pruneExpired(): void {
    const now = this.options.clock.now();
    for (const [key, record] of this.records) {
      if (record.expiresAtMs !== undefined && record.expiresAtMs <= now)
        this.records.delete(key);
    }
  }
}
