import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { parseCoolifySecretFixtureArguments } from "./coolify-secret-fixture-arguments.js"
import {
  NoEchoWriteReceiptSchema,
  verifyFingerprintReceiptPair,
} from "./fingerprint-receipt.js"
import {
  FINGERPRINT_RECEIPT_KIND,
  MANAGED_SECRET_ENVIRONMENT_KEY,
  RECEIPT_SIGNATURE_ALGORITHM,
} from "./fingerprint-receipt-vocabulary.js"
import {
  deferLiveManagerInitVerification,
  type ManagerInitConfigBoundVerification,
  type ManagerInitContractVerification,
  ManagerInitVerificationError,
  verifyManagerInitContractFixture,
} from "./manager-init-contract.js"
import {
  MANAGER_INIT_VERIFICATION_RESULT_KIND,
  MANAGER_INIT_VERIFICATION_SURFACE,
  REQUIRED_MANAGER_STATUS_CAP_FIELDS,
} from "./manager-init-vocabulary.js"
import { computeSecretFingerprint, type SecretFingerprint } from "./secret-fingerprint.js"
import {
  COOLIFY_PRODUCTION_OWNER,
  FINGERPRINT_PROOF_LEVEL,
  MANAGED_PROJECT_RUNTIME_STATE,
} from "./deployment-vocabulary.js"
import { EXPECTED_OVERLAY_PLAN_SHA256 } from "./managed-overlay-catalog.js"
import { parseJson, sha256 } from "./upstream-corpus-primitives.js"
import { verifyRuntimeScopeAtRepository } from "./runtime-scope-files.js"
import {
  COOLIFY_SECRET_FIXTURE_MODE,
  COOLIFY_SECRET_FIXTURE_SEQUENCE,
} from "./runtime-scope-fixture-vocabulary.js"
import { evaluateRuntimeScopeMutations } from "./runtime-scope-mutations.js"
import { RuntimeScopeCertificateSchema } from "./runtime-scope.js"
import { RUNTIME_SCOPE_PATH, RUNTIME_SCOPE_POOL } from "./runtime-scope-vocabulary.js"

const FIXTURE_PATH = "managed/tests/fixtures/runtime-scope/manager-init.valid.json"
const RESULT_FILE = "runtime-scope-fixture-result.json"
async function readJson(filePath: string): Promise<unknown> {
  return parseJson(await readFile(filePath, "utf8"), filePath)
}

type ManagedSlot =
  | typeof COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE
  | typeof COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN

function assertNever(value: never): never {
  return value
}

function requireConfigBoundManagerInit(
  result: ManagerInitContractVerification,
): ManagerInitConfigBoundVerification {
  switch (result.kind) {
    case MANAGER_INIT_VERIFICATION_RESULT_KIND.CONFIG_BOUND:
      return result
    case MANAGER_INIT_VERIFICATION_RESULT_KIND.LIVE_PROOF_DEFERRED_TO_TASK_41:
      throw new ManagerInitVerificationError(result.kind, result.kind)
    default:
      return assertNever(result)
  }
}

function buildConfigReceipt(slot: ManagedSlot, fingerprint: SecretFingerprint) {
  const common = {
    schemaVersion: 1,
    kind: FINGERPRINT_RECEIPT_KIND.CONFIG_WRITE,
    proofLevel: FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
    createTokenKeyId: fingerprint.createTokenKeyId,
    fingerprintHmacSha256: fingerprint.fingerprintHmacSha256,
    overlayPlanSha256: EXPECTED_OVERLAY_PLAN_SHA256,
    environment: {
      key: MANAGED_SECRET_ENVIRONMENT_KEY,
      isPreview: false,
      isLiteral: true,
      isMultiline: false,
      isShownOnce: true,
      isRuntime: true,
      isBuildtime: false,
    },
    signature: {
      algorithm: RECEIPT_SIGNATURE_ALGORITHM.HMAC_SHA256,
      keyId: sha256("synthetic-receipt-signing-key-id"),
      hmacSha256: sha256(`synthetic-receipt-signature:${slot}`),
    },
  } as const
  switch (slot) {
    case COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE:
      return NoEchoWriteReceiptSchema.parse({
        ...common,
        applicationId: "10000000-0000-4000-8000-000000000001",
        slot,
        poolId: RUNTIME_SCOPE_POOL.BLUE,
        configSha256: sha256("synthetic-blue-config"),
        environment: { ...common.environment, uuid: "20000000-0000-4000-8000-000000000001" },
      })
    case COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN:
      return NoEchoWriteReceiptSchema.parse({
        ...common,
        applicationId: "10000000-0000-4000-8000-000000000002",
        slot,
        poolId: RUNTIME_SCOPE_POOL.GREEN,
        configSha256: sha256("synthetic-green-config"),
        environment: { ...common.environment, uuid: "20000000-0000-4000-8000-000000000002" },
      })
    default:
      return assertNever(slot)
  }
}

function buildStartedManagerReceipt(configReceipt: ReturnType<typeof buildConfigReceipt>) {
  return {
    schemaVersion: 1,
    kind: FINGERPRINT_RECEIPT_KIND.STARTED_MANAGER,
    applicationId: configReceipt.applicationId,
    managerInstanceId: "30000000-0000-4000-8000-000000000001",
    managerImageDigest: `sha256:${sha256("synthetic-manager-image")}`,
    observedAt: "2026-07-20T14:00:00.000Z",
    createTokenKeyId: configReceipt.createTokenKeyId,
    configSha256: configReceipt.configSha256,
    fingerprintHmacSha256: configReceipt.fingerprintHmacSha256,
    managerStatusSha256: sha256("synthetic-manager-status"),
    configEnvSha256: sha256("synthetic-config-env"),
    processEnvironmentSha256: sha256("synthetic-process-env"),
    fdInventorySha256: sha256("synthetic-fd-inventory"),
  }
}

async function writeEvidence(evidenceDirectory: string, result: unknown): Promise<string> {
  const resolvedDirectory = path.resolve(evidenceDirectory)
  await mkdir(resolvedDirectory, { recursive: true, mode: 0o700 })
  const resultPath = path.join(resolvedDirectory, RESULT_FILE)
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  return resultPath
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd()
  const options = parseCoolifySecretFixtureArguments(process.argv.slice(2))
  if (options.liveObservationPath !== undefined) {
    const deferred = deferLiveManagerInitVerification()
    throw new ManagerInitVerificationError(deferred.kind, deferred.kind)
  }

  const managerInitInput = await readJson(path.join(repositoryRoot, FIXTURE_PATH))
  const runtimeScope = await verifyRuntimeScopeAtRepository(repositoryRoot)
  const managerInit = requireConfigBoundManagerInit(
    verifyManagerInitContractFixture({ fixtureInput: managerInitInput }),
  )
  const blueKey = Buffer.alloc(32, 0x5a)
  const greenKey = Buffer.alloc(32, 0x5a)
  const blueFingerprint = computeSecretFingerprint(blueKey)
  const greenFingerprint = computeSecretFingerprint(greenKey)
  blueKey.fill(0)
  greenKey.fill(0)
  const blueReceipt = buildConfigReceipt(COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE, blueFingerprint)
  const greenReceipt = buildConfigReceipt(COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN, greenFingerprint)
  const fingerprintPair = verifyFingerprintReceiptPair({
    blueReceiptInput: blueReceipt,
    greenReceiptInput: greenReceipt,
  })
  const certificateInput = RuntimeScopeCertificateSchema.parse(
    await readJson(path.join(repositoryRoot, RUNTIME_SCOPE_PATH)),
  )
  const stoppedRuntimeProofInput = {
    proofLevel: FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED,
    projectRuntimeState: MANAGED_PROJECT_RUNTIME_STATE.COLD_STANDBY,
    configReceipt: blueReceipt,
    startedManagerReceipt: buildStartedManagerReceipt(blueReceipt),
  }
  const mutationResults = options.mutations === undefined
    ? []
    : evaluateRuntimeScopeMutations({
        mutationInputs: options.mutations,
        certificateInput,
        managerInitInput,
        stoppedRuntimeProofInput,
      })
  if (options.mutations !== undefined) {
    console.log(`COOLIFY_SECRET_FIXTURE_MUTATIONS_REJECTED ${JSON.stringify(mutationResults)}`)
    return
  }

  const expectedCapFields = REQUIRED_MANAGER_STATUS_CAP_FIELDS.join(",")
  if (
    options.mode !== COOLIFY_SECRET_FIXTURE_MODE.RAW_COMPOSE_MANAGER_SECRET ||
    options.sequence !== COOLIFY_SECRET_FIXTURE_SEQUENCE.BLUE_THEN_GREEN ||
    options.initialUid !== 0 ||
    options.capabilityFields !== expectedCapFields ||
    !options.assertNoSecretFd
  ) {
    throw new TypeError("happy fixture requires the complete asserted contract")
  }
  const result = {
    schemaVersion: 1,
    verificationSurface: MANAGER_INIT_VERIFICATION_SURFACE.SYNTHETIC_CONTRACT,
    runtimeScope,
    managerInit,
    fingerprintPair,
    fingerprintsEqual: blueFingerprint.fingerprintHmacSha256 === greenFingerprint.fingerprintHmacSha256,
  }
  const evidencePath = options.evidenceDirectory === undefined
    ? undefined
    : await writeEvidence(options.evidenceDirectory, result)
  console.log(`COOLIFY_SECRET_FIXTURE_VERIFIED ${JSON.stringify({ ...result, evidencePath })}`)
}

main().catch((error: unknown) => {
  if (error instanceof Error) console.error(`${error.name}: ${error.message}`)
  else console.error("Unknown Coolify secret fixture failure")
  process.exitCode = 1
})
