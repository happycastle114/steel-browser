import {
  CAPACITY_GATE_OUTCOME,
  COOLIFY_COMPOSE_DEPLOYMENT_MODE,
  COOLIFY_CUTOVER_MODE,
  COOLIFY_DEPLOYMENT_STATUS,
  COOLIFY_OPERATION_STATE,
  COOLIFY_PRODUCTION_OWNER,
  COOLIFY_SECRET_ISOLATION_MODE,
  DEPLOYMENT_CAPACITY_STATUS,
  DEPLOYMENT_GATE_OUTCOME,
  DISCOVERY_MODE,
  FINGERPRINT_PROOF_LEVEL,
  MANAGED_DEPLOYMENT_CONFIG,
  MANAGED_PROJECT_RUNTIME_STATE,
} from "../src/managed-overlay.js"

export function validSourceConfig(
  capacityStatus: (typeof DEPLOYMENT_CAPACITY_STATUS)[keyof typeof DEPLOYMENT_CAPACITY_STATUS] =
    DEPLOYMENT_CAPACITY_STATUS.UNVERIFIED_UNTIL_TASK_41,
) {
  return {
    maxConcurrentManagedProjects: MANAGED_DEPLOYMENT_CONFIG.maxConcurrentManagedProjects,
    activeWorkerCount: MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount,
    maxVerifiedWorkersTotal: MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount,
    discoveryMode: DISCOVERY_MODE.STATIC_CONFIG,
    staticWorkerEndpoints: MANAGED_DEPLOYMENT_CONFIG.staticWorkerEndpoints,
    cutoverMode: COOLIFY_CUTOVER_MODE.SERIAL_MAINTENANCE,
    composeDeploymentMode: COOLIFY_COMPOSE_DEPLOYMENT_MODE.RAW_EXPLICIT_PROXY,
    secretIsolationMode: COOLIFY_SECRET_ISOLATION_MODE.RAW_COMPOSE_MANAGER_SECRET,
    managerSecret: {
      sourcePath: MANAGED_DEPLOYMENT_CONFIG.managerSecretSourcePath,
      targetPath: MANAGED_DEPLOYMENT_CONFIG.managerSecretTargetPath,
      managerGrantCount: MANAGED_DEPLOYMENT_CONFIG.managerSecretGrantCount,
      workerGrantCount: MANAGED_DEPLOYMENT_CONFIG.workerSecretGrantCount,
      containerEnvironmentKeys: [],
      serviceEnvironmentFiles: [],
    },
    capacityStatus,
  }
}

export function activeProject(slot = COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE) {
  return {
    slot,
    runtimeState: MANAGED_PROJECT_RUNTIME_STATE.ACTIVE,
    managerCount: MANAGED_DEPLOYMENT_CONFIG.activeManagerCount,
    workerCount: MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount,
    containerCount: MANAGED_DEPLOYMENT_CONFIG.activeContainerCount,
    listenerCount: MANAGED_DEPLOYMENT_CONFIG.activeListenerCount,
    connectionCount: 0,
    automaticRestartEnabled: true,
  }
}

export function coldProject(slot = COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN) {
  return {
    slot,
    runtimeState: MANAGED_PROJECT_RUNTIME_STATE.COLD_STANDBY,
    managerCount: 0,
    workerCount: 0,
    containerCount: 0,
    listenerCount: 0,
    connectionCount: 0,
    automaticRestartEnabled: false,
  }
}

export function validTopology() {
  return {
    config: validSourceConfig(),
    projects: [activeProject(), coldProject()],
  }
}

export function validCutoverGate() {
  return {
    capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
    capacityGateOutcome: CAPACITY_GATE_OUTCOME.VERIFIED,
    deploymentGateOutcome: DEPLOYMENT_GATE_OUTCOME.VERIFIED,
    fingerprintProofLevel: FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED,
    operationState: COOLIFY_OPERATION_STATE.TERMINAL_SUCCESS,
    deploymentStatus: COOLIFY_DEPLOYMENT_STATUS.FINISHED,
  }
}

export function validShmTmpfsCapacity() {
  return {
    manager: {
      limitBytes: 1_000,
      baseP95Bytes: 400,
      tmpfsLimitBytes: 200,
      otherReservedBytes: 200,
      actualTmpfsLimitBytes: 200,
      signedTmpfsLimitBytes: 200,
    },
    worker: {
      limitBytes: 1_000,
      baseP95Bytes: 400,
      shmLimitBytes: 100,
      runTmpfsBytes: 100,
      tmpTmpfsBytes: 100,
      profileTmpfsBytes: 100,
      actualShmLimitBytes: 100,
      actualRunTmpfsBytes: 100,
      actualTmpTmpfsBytes: 100,
      actualProfileTmpfsBytes: 100,
      signedShmLimitBytes: 100,
      signedRunTmpfsBytes: 100,
      signedTmpTmpfsBytes: 100,
      signedProfileTmpfsBytes: 100,
      baseP95BytesByWorker: [400, 400],
    },
    measurementFresh: true,
    mountsBounded: true,
    warmIdleUsableSamplesByWorker: [300, 300],
    warmIdleSampleIntervalSeconds: 1,
    warmIdleMountsEmpty: true,
    warmIdleSessionCount: 0,
    warmIdleRestartCount: 0,
    warmIdleOomCount: 0,
  }
}

export function validPressureCapacity() {
  return {
    baselineUsableSamples: 300,
    pressureUsableSamples: 300,
    pressureWindowSeconds: 300,
    sampleIntervalSeconds: 1,
    sessionOverlapMs: 5_000,
    workerLoopMaxIntervalSeconds: [10, 10],
    oomCount: 0,
    oomKillCount: 0,
    restartCount: 0,
    failedHealthProbeCount: 0,
    memoryThresholdsVerified: true,
    cpuThresholdsVerified: true,
    diskThresholdsVerified: true,
    inodeThresholdsVerified: true,
  }
}
