import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_DEFAULTS,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  PoolSchema,
} from "@happycastle/steel-managed-shared/browser";
import {
  CLIENT_CONFIG_CASES,
  MANAGER_INSTANCE_ID,
  OTHER_MANAGER_INSTANCE_ID,
  clientConfig,
  clientWith,
  managedPool,
  success,
  type RecordedRequest,
} from "./operations-client-test-support.js";

function drainInput(ttlMs: number) {
  return {
    idempotencyKey: `client-drain-${ttlMs}`,
    expectedManagerInstanceId: MANAGER_INSTANCE_ID,
    deadlineAt: new Date(1_000 + ttlMs).toISOString(),
    reason: MANAGER_MODE_CAUSE.CUTOVER,
  };
}

function resumeInput(ttlMs: number) {
  return {
    idempotencyKey: `client-resume-${ttlMs}`,
    expectedManagerInstanceId: MANAGER_INSTANCE_ID,
    expectedSafeAt: new Date(1_000 + ttlMs).toISOString(),
    reason: MANAGER_MODE_CAUSE.RECOVERY,
  };
}

function foreignTtl(ttlMs: number): number {
  return ttlMs === CONTROL_PLANE_DEFAULTS.idempotencyTtlMs
    ? CLIENT_CONFIG_CASES[2].ttlMs
    : CONTROL_PLANE_DEFAULTS.idempotencyTtlMs;
}

describe("ManagedOperationsClient configuration-bound pool responses", () => {
  it.each(CLIENT_CONFIG_CASES)(
    "uses the canonical $name config for GET, drain, and resume",
    async ({ ttlMs }) => {
      // Given
      const config = clientConfig(ttlMs);
      const drained = managedPool(config);
      const serving = managedPool(config, MANAGER_MODE.SERVING);
      const requests: RecordedRequest[] = [];
      const api = clientWith(
        [success(drained), success(drained), success(serving)],
        requests,
        config,
      );

      // When
      const read = await api.getPool();
      const drain = await api.drainPool(drainInput(ttlMs));
      const resume = await api.resumePool(resumeInput(ttlMs));

      // Then
      expect(read.handover).toMatchObject({ idempotencyTtlMs: ttlMs });
      expect(drain).toMatchObject({
        mode: MANAGER_MODE.DRAINING,
        handover: { idempotencyTtlMs: ttlMs },
      });
      expect(resume.mode).toBe(MANAGER_MODE.SERVING);
      expect(requests.map(({ request }) => request.method)).toEqual([
        "GET",
        "POST",
        "POST",
      ]);
    },
  );

  it.each(CLIENT_CONFIG_CASES)(
    "rejects $name responses produced for another parsed config",
    async ({ ttlMs }) => {
      // Given
      const config = clientConfig(ttlMs);
      const foreign = managedPool(clientConfig(foreignTtl(ttlMs)));
      const api = clientWith([success(foreign), success(foreign)], [], config);

      // When
      const read = () => api.getPool();
      const drain = () => api.drainPool(drainInput(ttlMs));

      // Then
      await expect(read()).rejects.toMatchObject({
        name: "ManagedApiProtocolError",
      });
      await expect(drain()).rejects.toMatchObject({
        name: "ManagedApiProtocolError",
      });
    },
  );

  it("binds mutation results to the requested manager and mode", async () => {
    // Given
    const config = clientConfig();
    const serving = managedPool(config, MANAGER_MODE.SERVING);
    const draining = managedPool(config, MANAGER_MODE.DRAINING);
    const otherManager = managedPool(
      config,
      MANAGER_MODE.DRAINING,
      OTHER_MANAGER_INSTANCE_ID,
    );
    const api = clientWith(
      [success(serving), success(draining), success(otherManager)],
      [],
      config,
    );

    // When
    const drain = () => api.drainPool(drainInput(config.idempotencyTtlMs));
    const resume = () => api.resumePool(resumeInput(config.idempotencyTtlMs));
    const wrongManager = () =>
      api.drainPool(drainInput(config.idempotencyTtlMs));

    // Then
    await expect(drain()).rejects.toMatchObject({
      name: "ManagedApiProtocolError",
    });
    await expect(resume()).rejects.toMatchObject({
      name: "ManagedApiProtocolError",
    });
    await expect(wrongManager()).rejects.toMatchObject({
      name: "ManagedApiProtocolError",
    });
  });

  it("rejects pool identity, queue, and memory drift from its config", async () => {
    // Given
    const config = clientConfig();
    const valid = managedPool(config);
    const drift = PoolSchema.parse({
      ...valid,
      poolId: "managed-green",
      queue: { ...valid.queue, max: valid.queue.max + 1 },
      memory: {
        ...valid.memory,
        dynamicLimitBytes: valid.memory.dynamicLimitBytes + 1,
        result: {
          ...valid.memory.result,
          limitBytes: valid.memory.result.limitBytes + 1,
        },
      },
    });
    const api = clientWith([success(drift)], [], config);

    // When
    const read = () => api.getPool();

    // Then
    await expect(read()).rejects.toMatchObject({
      name: "ManagedApiProtocolError",
    });
  });
});
