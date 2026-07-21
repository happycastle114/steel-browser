import {
  ADMISSION_STATE,
  AdmissionIdSchema,
  CONFIGURABLE_NUMERIC_BOUNDS,
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_DEFAULTS,
  CONTROL_PLANE_FIXED,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  SESSION_STATE,
  SessionIdSchema,
  parseControlPlaneConfig,
  poolSchemaForConfig,
  type ControlPlaneConfig,
  type ManagerMode,
} from "@happycastle/steel-managed-shared/browser";
import {
  ManagedOperationsClient,
  type ManagedFetch,
  type ManagedFetchRequest,
} from "../src/index.js";

class OperationsClientFixtureError extends Error {
  public override readonly name = "OperationsClientFixtureError";
}

export const SESSION_ID = SessionIdSchema.parse(
  "00000000-0000-4000-8000-000000000001",
);
export const OTHER_SESSION_ID = SessionIdSchema.parse(
  "00000000-0000-4000-8000-000000000002",
);
export const ADMISSION_ID = AdmissionIdSchema.parse(
  "00000000-0000-4000-8000-000000000011",
);
export const OTHER_ADMISSION_ID = AdmissionIdSchema.parse(
  "00000000-0000-4000-8000-000000000012",
);
export const MANAGER_INSTANCE_ID =
  "00000000-0000-4000-8000-000000000300";
export const OTHER_MANAGER_INSTANCE_ID =
  "00000000-0000-4000-8000-000000000301";

const CONFIG_INPUT = {
  maxConcurrentManagedProjects:
    CONTROL_PLANE_FIXED.maxConcurrentManagedProjects,
  activeManagerCount: CONTROL_PLANE_FIXED.activeManagerCount,
  activeWorkerCount: CONTROL_PLANE_FIXED.activeWorkerCount,
  coldStandbyProjectCount: CONTROL_PLANE_FIXED.coldStandbyProjectCount,
  managerBaseP95Bytes: 100_000_000,
  accessIssuer: "https://happycastle.cloudflareaccess.com",
  accessAudience: "steel-audience",
  allowedHosts: ["steel.soungmin.kr"],
  publicOriginByHost: {
    "steel.soungmin.kr": "https://steel.soungmin.kr",
  },
  operatorServicePrincipals: ["steel-operator"],
  poolId: "managed-blue",
};

export const CLIENT_CONFIG_CASES = [
  {
    name: "minimum",
    ttlMs: CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.minimum,
  },
  { name: "default", ttlMs: CONTROL_PLANE_DEFAULTS.idempotencyTtlMs },
  {
    name: "maximum",
    ttlMs: CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.maximum,
  },
  { name: "explicit custom 60 seconds", ttlMs: 60_000 },
] as const;

export function clientConfig(
  idempotencyTtlMs: number = CONTROL_PLANE_DEFAULTS.idempotencyTtlMs,
): ControlPlaneConfig {
  return parseControlPlaneConfig({ ...CONFIG_INPUT, idempotencyTtlMs });
}

function memoryLedger(limitBytes: number, limitCount: number) {
  return {
    reservedBytes: 0,
    limitBytes,
    reservedCount: 0,
    limitCount,
  };
}

export function managedPool(
  config: ControlPlaneConfig,
  mode: ManagerMode = MANAGER_MODE.DRAINING,
  managerInstanceId: string = MANAGER_INSTANCE_ID,
) {
  const blocking = {
    queued: 0,
    reserved: 0,
    starting: 0,
    live: 0,
    releasing: 0,
    uncertain: 0,
    httpCreates: 0,
    webSockets: 0,
  };
  const handover =
    mode === MANAGER_MODE.SERVING
      ? { mode, safe: false, blocking }
      : {
          mode,
          safe: false,
          managerInstanceId,
          cause: MANAGER_MODE_CAUSE.CUTOVER,
          drainEnteredAt: new Date(0).toISOString(),
          lastMutationAt: new Date(1_000).toISOString(),
          idempotencyTtlMs: config.idempotencyTtlMs,
          safeAt: new Date(1_000 + config.idempotencyTtlMs).toISOString(),
          blocking,
        };
  return poolSchemaForConfig(config).parse({
    apiVersion: CONTROL_PLANE_API_VERSION,
    poolId: config.poolId,
    managerInstanceId,
    mode,
    handover,
    counts: {
      physical: CONTROL_PLANE_FIXED.activeWorkerCount,
      usableReachable: 2,
      reconciledIdle: 2,
      busy: 0,
      unavailable: 0,
      byState: {
        discovered: 0,
        reachable: 0,
        idle: 2,
        reserved: 0,
        starting: 0,
        live: 0,
        releasing: 0,
        unreachable: 0,
        quarantined: 0,
        draining: 0,
      },
    },
    queue: { depth: 0, max: config.queueMax, oldestWaitMs: 0 },
    memory: {
      managerLimitBytes: config.memory.managerLimitBytes,
      baseP95Bytes: config.managerBaseP95Bytes,
      tmpfsLimitBytes: CONTROL_PLANE_FIXED.managerTmpfsLimitBytes,
      snapshotLimitBytes: CONTROL_PLANE_FIXED.listSnapshotBytes,
      dynamicLimitBytes: config.memory.dynamicLimitBytes,
      result: memoryLedger(
        config.memory.resultBudgetBytes,
        config.memory.resultCountLimit,
      ),
      action: memoryLedger(
        config.memory.actionBudgetBytes,
        config.memory.actionMax,
      ),
      webSocket: memoryLedger(
        config.memory.webSocketBudgetBytes,
        config.memory.webSocketMax,
      ),
      ingressConnection: memoryLedger(
        config.memory.ingressConnectionBudgetBytes,
        config.memory.ingressConnectionMax,
      ),
      ingressBody: memoryLedger(
        config.memory.ingressBodyBudgetBytes,
        config.memory.ingressBodyMax,
      ),
    },
    generatedAt: new Date(1_000).toISOString(),
  });
}

export function session(sessionId = SESSION_ID) {
  return {
    sessionId,
    state: SESSION_STATE.LIVE,
    createdAt: new Date(1).toISOString(),
    startedAt: new Date(2).toISOString(),
  };
}

export function admission(admissionId = ADMISSION_ID) {
  return {
    admissionId,
    state: ADMISSION_STATE.CANCELLED,
    createdAt: new Date(1).toISOString(),
    expiresAt: new Date(60_001).toISOString(),
    updatedAt: new Date(2).toISOString(),
  };
}

export function success(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

export type RecordedRequest = Readonly<{
  request: ManagedFetchRequest;
  url: string;
}>;

export function clientWith(
  responses: readonly ReturnType<typeof success>[],
  requests: RecordedRequest[] = [],
  config: ControlPlaneConfig = clientConfig(),
) {
  const pending = [...responses];
  const fetch: ManagedFetch = async (url, request) => {
    requests.push({ request, url });
    const response = pending.shift();
    if (response === undefined) {
      throw new OperationsClientFixtureError("missing client response fixture");
    }
    return response;
  };
  return new ManagedOperationsClient({
    baseUrl: "https://steel.example.test/",
    config,
    fetch,
  });
}
