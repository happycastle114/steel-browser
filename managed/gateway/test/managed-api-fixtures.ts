import {
  ADMISSION_STATE,
  AdmissionIdSchema,
  AdmissionSchema,
  CONFIGURABLE_NUMERIC_BOUNDS,
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_FIXED,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  ManagerInstanceIdSchema,
  PRINCIPAL_ROLE,
  PrincipalIdSchema,
  SESSION_STATE,
  SessionIdSchema,
  SessionSchema,
  Sha256Schema,
  UuidSchema,
  parseControlPlaneConfig,
  poolSchemaForConfig,
  type ControlPlaneConfig,
  type ManagerModeCause,
  type Pool,
} from "@happycastle/steel-managed-shared";
import type {
  ManagedOperationsClock,
  ManagedPrincipal,
} from "../src/api/operations/index.js";

export class ApiClock implements ManagedOperationsClock {
  public constructor(private currentMilliseconds = 1_000) {}

  public now(): number {
    return this.currentMilliseconds;
  }

  public advance(milliseconds: number): void {
    this.currentMilliseconds += milliseconds;
  }
}

export function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

export const USER_A_ID = PrincipalIdSchema.parse("USER:alpha");
export const USER_B_ID = PrincipalIdSchema.parse("USER:beta");
export const USER_A: ManagedPrincipal = {
  principalDigest: Sha256Schema.parse("a".repeat(64)),
  principalId: USER_A_ID,
  role: PRINCIPAL_ROLE.USER,
};
export const USER_B: ManagedPrincipal = {
  principalDigest: Sha256Schema.parse("b".repeat(64)),
  principalId: USER_B_ID,
  role: PRINCIPAL_ROLE.USER,
};
export const OPERATOR: ManagedPrincipal = {
  principalDigest: Sha256Schema.parse("c".repeat(64)),
  principalId: PrincipalIdSchema.parse("SERVICE_TOKEN:operator"),
  role: PRINCIPAL_ROLE.OPERATOR,
};

const CONTROL_PLANE_CONFIG_INPUT = {
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

export function controlPlaneConfig(
  idempotencyTtlMs: number =
    CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.minimum,
): ControlPlaneConfig {
  return parseControlPlaneConfig({
    ...CONTROL_PLANE_CONFIG_INPUT,
    idempotencyTtlMs,
  });
}

export const CONTROL_PLANE_CONFIG = controlPlaneConfig();

export const SESSION_A = SessionSchema.parse({
  sessionId: uuid(1),
  state: SESSION_STATE.LIVE,
  createdAt: new Date(1).toISOString(),
  startedAt: new Date(2).toISOString(),
});
export const SESSION_B = SessionSchema.parse({
  sessionId: uuid(2),
  state: SESSION_STATE.LIVE,
  createdAt: new Date(2).toISOString(),
  startedAt: new Date(3).toISOString(),
});
export const ADMISSION_A = AdmissionSchema.parse({
  admissionId: uuid(11),
  state: ADMISSION_STATE.QUEUED,
  position: 1,
  createdAt: new Date(1).toISOString(),
  expiresAt: new Date(60_001).toISOString(),
  updatedAt: new Date(1).toISOString(),
});
export const ADMISSION_B = AdmissionSchema.parse({
  admissionId: uuid(12),
  state: ADMISSION_STATE.QUEUED,
  position: 2,
  createdAt: new Date(2).toISOString(),
  expiresAt: new Date(60_002).toISOString(),
  updatedAt: new Date(2).toISOString(),
});

function memoryLedger(limitBytes: number, limitCount: number) {
  return {
    reservedBytes: 0,
    limitBytes,
    reservedCount: 0,
    limitCount,
  };
}

export function pool(
  mode:
    | typeof MANAGER_MODE.SERVING
    | typeof MANAGER_MODE.DRAINING = MANAGER_MODE.SERVING,
  cause: ManagerModeCause = MANAGER_MODE_CAUSE.RECOVERY,
  config: ControlPlaneConfig = CONTROL_PLANE_CONFIG,
): Pool {
  const managerInstanceId = ManagerInstanceIdSchema.parse(uuid(300));
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
          cause,
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
      physical: 2,
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

export const SESSION_A_ID = SessionIdSchema.parse(SESSION_A.sessionId);
export const ADMISSION_A_ID = AdmissionIdSchema.parse(ADMISSION_A.admissionId);
export const MISSING_SESSION_ID = SessionIdSchema.parse(uuid(99));
export const MISSING_ADMISSION_ID = AdmissionIdSchema.parse(uuid(98));
export const MUTATION_BODY = {};
export const IDEMPOTENCY_KEY = "managed-test-key";
export const MANAGER_INSTANCE_ID = ManagerInstanceIdSchema.parse(uuid(300));
export const REQUEST_ID = UuidSchema.parse(uuid(500));
