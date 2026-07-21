import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIGURABLE_NUMERIC_BOUNDS,
  CONTROL_PLANE_DEFAULTS,
  MANAGED_ERROR_CODE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  PoolSchema,
  type ControlPlaneConfig,
  type Pool,
} from "@happycastle/steel-managed-shared";
import type { ManagedPoolDrainCommand } from "../src/api/operations/index.js";
import {
  IDEMPOTENCY_KEY,
  MANAGER_INSTANCE_ID,
  OPERATOR,
  RecordingOperationsPort,
  buildManagedApi,
  controlPlaneConfig,
  pool,
} from "./managed-api-test-support.js";

const CUSTOM_SIXTY_SECONDS_MS = 60_000;
const CONFIG_CASES = [
  {
    name: "minimum",
    ttlMs: CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.minimum,
  },
  { name: "default", ttlMs: CONTROL_PLANE_DEFAULTS.idempotencyTtlMs },
  {
    name: "maximum",
    ttlMs: CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.maximum,
  },
  { name: "explicit custom 60 seconds", ttlMs: CUSTOM_SIXTY_SECONDS_MS },
] as const;

const apps: Array<Awaited<ReturnType<typeof buildManagedApi>>["app"]> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

class ForgedPoolPort extends RecordingOperationsPort {
  public constructor(
    config: ControlPlaneConfig,
    private readonly forgedPool: Pool,
  ) {
    super(config);
    this.currentPool = forgedPool;
  }

  public override async drainPool(
    _command: ManagedPoolDrainCommand,
  ): Promise<Pool> {
    this.mutations += 1;
    return this.forgedPool;
  }
}

function drainBody(ttlMs: number) {
  return {
    idempotencyKey: `${IDEMPOTENCY_KEY}-${ttlMs}`,
    expectedManagerInstanceId: MANAGER_INSTANCE_ID,
    deadlineAt: new Date(1_000 + ttlMs).toISOString(),
    reason: MANAGER_MODE_CAUSE.CUTOVER,
  };
}

function resumeBody(ttlMs: number) {
  return {
    idempotencyKey: `${IDEMPOTENCY_KEY}-resume-${ttlMs}`,
    expectedManagerInstanceId: MANAGER_INSTANCE_ID,
    expectedSafeAt: new Date(1_000 + ttlMs).toISOString(),
    reason: MANAGER_MODE_CAUSE.RECOVERY,
  };
}

function otherConfig(ttlMs: number): ControlPlaneConfig {
  const otherTtl =
    ttlMs === CONTROL_PLANE_DEFAULTS.idempotencyTtlMs
      ? CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.maximum
      : CONTROL_PLANE_DEFAULTS.idempotencyTtlMs;
  return controlPlaneConfig(otherTtl);
}

describe("managed API configuration-bound pool responses", () => {
  it.each(CONFIG_CASES)(
    "serves GET, drain, and resume with the $name fence",
    async ({ ttlMs }) => {
      // Given
      const config = controlPlaneConfig(ttlMs);
      const port = new RecordingOperationsPort(config);
      const built = await buildManagedApi(OPERATOR, port, config);
      apps.push(built.app);

      // When
      const initial = await built.app.inject({
        method: "GET",
        url: "/v1/managed/pool",
      });
      const drained = await built.app.inject({
        method: "POST",
        url: "/v1/managed/pool/drain",
        payload: drainBody(ttlMs),
      });
      const resumed = await built.app.inject({
        method: "POST",
        url: "/v1/managed/pool/resume",
        payload: resumeBody(ttlMs),
      });

      // Then
      expect([initial.statusCode, drained.statusCode, resumed.statusCode]).toEqual([
        200, 200, 200,
      ]);
      expect(drained.json()).toMatchObject({
        mode: MANAGER_MODE.DRAINING,
        handover: {
          idempotencyTtlMs: ttlMs,
          safeAt: new Date(1_000 + ttlMs).toISOString(),
        },
      });
      expect(resumed.json()).toMatchObject({ mode: MANAGER_MODE.SERVING });
    },
  );

  it.each(CONFIG_CASES)(
    "rejects self-consistent $name pool data from another configuration",
    async ({ ttlMs }) => {
      // Given
      const config = controlPlaneConfig(ttlMs);
      const foreign = otherConfig(ttlMs);
      const forged = pool(
        MANAGER_MODE.DRAINING,
        MANAGER_MODE_CAUSE.CUTOVER,
        foreign,
      );
      const port = new ForgedPoolPort(config, forged);
      const built = await buildManagedApi(OPERATOR, port, config);
      apps.push(built.app);

      // When
      const read = await built.app.inject({
        method: "GET",
        url: "/v1/managed/pool",
      });
      const drain = await built.app.inject({
        method: "POST",
        url: "/v1/managed/pool/drain",
        payload: drainBody(ttlMs),
      });

      // Then
      expect([read.statusCode, drain.statusCode]).toEqual([502, 502]);
      expect([read.json(), drain.json()]).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
          }),
        }),
        expect.objectContaining({
          error: expect.objectContaining({
            code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
          }),
        }),
      ]);
    },
  );

  it("rejects configured pool identity, queue, and memory budget drift", async () => {
    // Given
    const config = controlPlaneConfig(CONTROL_PLANE_DEFAULTS.idempotencyTtlMs);
    const valid = pool(
      MANAGER_MODE.DRAINING,
      MANAGER_MODE_CAUSE.CUTOVER,
      config,
    );
    const drifts = [
      PoolSchema.parse({ ...valid, poolId: "managed-green" }),
      PoolSchema.parse({
        ...valid,
        queue: { ...valid.queue, max: valid.queue.max + 1 },
      }),
      PoolSchema.parse({
        ...valid,
        memory: {
          ...valid.memory,
          dynamicLimitBytes: valid.memory.dynamicLimitBytes + 1,
          result: {
            ...valid.memory.result,
            limitBytes: valid.memory.result.limitBytes + 1,
          },
        },
      }),
    ];

    // When
    const statuses = [];
    for (const drift of drifts) {
      const port = new ForgedPoolPort(config, drift);
      const built = await buildManagedApi(OPERATOR, port, config);
      apps.push(built.app);
      const response = await built.app.inject({
        method: "GET",
        url: "/v1/managed/pool",
      });
      statuses.push(response.statusCode);
    }

    // Then
    expect(statuses).toEqual([502, 502, 502]);
  });
});
