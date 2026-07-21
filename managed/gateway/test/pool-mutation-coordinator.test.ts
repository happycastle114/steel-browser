import { describe, expect, it } from "vitest";
import {
  CreateIdempotencyKeySchema,
  CONTROL_PLANE_FIXED,
  IsoTimeSchema,
  MANAGED_ERROR_CODE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  ManagerInstanceIdSchema,
  Sha256Schema,
  type Pool,
  type PoolDrainRequest,
} from "@happycastle/steel-managed-shared";
import {
  ManagedOperationsError,
  POOL_MUTATION_KIND,
  PoolMutationCoordinator,
} from "../src/api/operations/index.js";
import {
  ApiClock,
  CONTROL_PLANE_CONFIG,
  pool,
  uuid,
} from "./managed-api-test-support.js";

class ExpectedPoolMutationError extends Error {
  public override readonly name = "ExpectedPoolMutationError";
}

function deferredPool() {
  let complete: ((value: Pool) => void) | undefined;
  const promise = new Promise<Pool>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(value: Pool) {
      if (complete === undefined)
        throw new ExpectedPoolMutationError(
          "pool deferred was not initialized",
        );
      complete(value);
    },
  };
}

const PRINCIPAL_A = Sha256Schema.parse("a".repeat(64));
const PRINCIPAL_B = Sha256Schema.parse("b".repeat(64));

function request(
  idempotencyKey: string,
  reason: PoolDrainRequest["reason"] = MANAGER_MODE_CAUSE.CUTOVER,
): PoolDrainRequest {
  return {
    idempotencyKey: CreateIdempotencyKeySchema.parse(idempotencyKey),
    expectedManagerInstanceId: ManagerInstanceIdSchema.parse(uuid(300)),
    deadlineAt: IsoTimeSchema.parse(new Date(61_000).toISOString()),
    reason,
  };
}

function managedError(action: () => unknown): ManagedOperationsError {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedOperationsError) return error;
    throw error;
  }
  throw new ExpectedPoolMutationError("pool mutation did not fail");
}

function coordinator(clock = new ApiClock()): PoolMutationCoordinator {
  return new PoolMutationCoordinator({ clock, config: CONTROL_PLANE_CONFIG });
}

function execute(
  coordinator: PoolMutationCoordinator,
  input: Readonly<{
    action: () => Promise<ReturnType<typeof pool>>;
    principalDigest?: typeof PRINCIPAL_A;
    request: PoolDrainRequest;
  }>,
) {
  return coordinator.execute({
    action: input.action,
    idempotencyKey: input.request.idempotencyKey,
    kind: POOL_MUTATION_KIND.DRAIN,
    principalDigest: input.principalDigest ?? PRINCIPAL_A,
    request: input.request,
  });
}

describe("PoolMutationCoordinator", () => {
  it("coalesces concurrent matching requests into one domain mutation", async () => {
    // Given
    const replay = coordinator();
    const drain = request("same-request");
    let mutations = 0;
    const action = async () => {
      mutations += 1;
      return pool(MANAGER_MODE.DRAINING, drain.reason);
    };

    // When
    const first = execute(replay, { action, request: drain });
    const second = execute(replay, { action, request: drain });

    // Then
    await expect(first).resolves.toEqual(await second);
    expect(mutations).toBe(1);
  });

  it("rejects changed request content for the same principal and key", () => {
    // Given
    const replay = coordinator();
    const first = request("conflicting-request");
    void execute(replay, {
      action: async () => pool(MANAGER_MODE.DRAINING, first.reason),
      request: first,
    });

    // When
    const error = managedError(() =>
      execute(replay, {
        action: async () =>
          pool(MANAGER_MODE.DRAINING, MANAGER_MODE_CAUSE.ROLLBACK),
        request: request("conflicting-request", MANAGER_MODE_CAUSE.ROLLBACK),
      }),
    );

    // Then
    expect(error.code).toBe(MANAGED_ERROR_CODE.SESSION_STATE_CONFLICT);
  });

  it("scopes the same idempotency key independently by principal", async () => {
    // Given
    const replay = coordinator();
    const drain = request("principal-scoped");
    let mutations = 0;
    const action = async () => {
      mutations += 1;
      return pool(MANAGER_MODE.DRAINING, drain.reason);
    };

    // When
    await Promise.all([
      execute(replay, {
        action,
        principalDigest: PRINCIPAL_A,
        request: drain,
      }),
      execute(replay, {
        action,
        principalDigest: PRINCIPAL_B,
        request: drain,
      }),
    ]);

    // Then
    expect(mutations).toBe(2);
  });

  it("retains an entry until the exact TTL boundary and accepts it after expiry", async () => {
    // Given
    const clock = new ApiClock();
    const replay = coordinator(clock);
    const drain = request("ttl-boundary");
    let mutations = 0;
    const action = async () => {
      mutations += 1;
      return pool(MANAGER_MODE.DRAINING, drain.reason);
    };
    await execute(replay, { action, request: drain });

    // When
    clock.advance(CONTROL_PLANE_CONFIG.idempotencyTtlMs - 1);
    await execute(replay, { action, request: drain });
    clock.advance(1);
    await execute(replay, { action, request: drain });

    // Then
    expect(mutations).toBe(2);
  });

  it("fails closed at capacity without evicting an unexpired replay", () => {
    // Given
    const replay = coordinator();
    const pendingPool = new Promise<Pool>(() => undefined);
    for (let index = 0; index < CONTROL_PLANE_FIXED.idempotencyMax; index += 1) {
      const accepted = request(`capacity-${index}`);
      void execute(replay, {
        action: () => pendingPool,
        request: accepted,
      });
    }

    // When
    const error = managedError(() =>
      execute(replay, {
        action: async () =>
          pool(MANAGER_MODE.DRAINING, MANAGER_MODE_CAUSE.ROLLBACK),
        request: request("capacity-over", MANAGER_MODE_CAUSE.ROLLBACK),
      }),
    );

    // Then
    expect(error.code).toBe(MANAGED_ERROR_CODE.MANAGED_IDEMPOTENCY_CAPACITY);
    expect(error.retryAfterSeconds).toBe(1);
  });

  it("never expires or duplicates an in-flight mutation", async () => {
    // Given
    const clock = new ApiClock();
    const replayCoordinator = coordinator(clock);
    const drain = request("pending-beyond-ttl");
    const deferred = deferredPool();
    let mutations = 0;
    const action = () => {
      mutations += 1;
      return deferred.promise;
    };
    const first = execute(replayCoordinator, { action, request: drain });
    await Promise.resolve();

    // When
    clock.advance(CONTROL_PLANE_CONFIG.idempotencyTtlMs * 2);
    const replay = execute(replayCoordinator, { action, request: drain });
    deferred.resolve(pool(MANAGER_MODE.DRAINING, drain.reason));
    await first;

    // Then
    expect(replay).toBe(first);
    expect(mutations).toBe(1);
  });
});
