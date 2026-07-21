import { EXPECTED_OVERLAY_PLAN_SHA256 } from "./managed-overlay-catalog.js"
import { parseManagedOverlayDescriptor } from "./managed-overlay-verifier.js"
import {
  RuntimeScopeCertificateSchema,
  type RuntimeScopeCertificate,
} from "./runtime-scope.js"
import { parseJson, sha256 } from "./upstream-corpus-primitives.js"
import { LOCK_STAGE, parseUpstreamLock } from "./upstream-lock.js"

export const RUNTIME_SCOPE_ERROR_CODE = {
  SOURCE_MISSING: "SOURCE_MISSING",
  SOURCE_HASH_DRIFT: "SOURCE_HASH_DRIFT",
  OVERLAY_BINDING_DRIFT: "OVERLAY_BINDING_DRIFT",
  UPSTREAM_LOCK_STAGE_DRIFT: "UPSTREAM_LOCK_STAGE_DRIFT",
  CORPUS_BINDING_DRIFT: "CORPUS_BINDING_DRIFT",
} as const

type RuntimeScopeErrorCode =
  (typeof RUNTIME_SCOPE_ERROR_CODE)[keyof typeof RUNTIME_SCOPE_ERROR_CODE]

export class RuntimeScopeVerificationError extends Error {
  public override readonly name = "RuntimeScopeVerificationError"

  public constructor(
    public readonly code: RuntimeScopeErrorCode,
    detail: string,
  ) {
    super(detail)
  }
}

export type RuntimeScopeVerificationInput = Readonly<{
  readonly certificateInput: unknown
  readonly sourceTexts: Readonly<Record<string, string>>
}>

export type RuntimeScopeVerification = Readonly<{
  readonly overlayPlanSha256: string
  readonly capacityStatus: RuntimeScopeCertificate["capacityStatus"]
  readonly proofLevel: RuntimeScopeCertificate["proofLevel"]
  readonly workerPoolIds: readonly string[]
  readonly scopedWorkerIds: readonly string[]
  readonly sourceSha256ByPath: Readonly<Record<string, string>>
}>

function fail(code: RuntimeScopeErrorCode, detail: string): never {
  throw new RuntimeScopeVerificationError(code, detail)
}

type BindingExpectation = Readonly<{
  readonly actual: string
  readonly expected: string
  readonly code: RuntimeScopeErrorCode
  readonly detail: string
}>

function requireBound(expectation: BindingExpectation): void {
  if (expectation.actual !== expectation.expected) {
    fail(expectation.code, expectation.detail)
  }
}

function requireSource(
  sourceTexts: Readonly<Record<string, string>>,
  sourcePath: string,
): string {
  const sourceText = sourceTexts[sourcePath]
  if (sourceText === undefined) {
    return fail(RUNTIME_SCOPE_ERROR_CODE.SOURCE_MISSING, `source missing: ${sourcePath}`)
  }
  return sourceText
}

export function verifyRuntimeScopeCertificate(
  input: RuntimeScopeVerificationInput,
): RuntimeScopeVerification {
  const certificate = RuntimeScopeCertificateSchema.parse(input.certificateInput)
  const sourceSha256ByPath: Record<string, string> = {}
  for (const contract of Object.values(certificate.sourceContracts)) {
    const sourceText = requireSource(input.sourceTexts, contract.path)
    const sourceSha256 = sha256(sourceText)
    requireBound({
      actual: sourceSha256,
      expected: contract.sha256,
      code: RUNTIME_SCOPE_ERROR_CODE.SOURCE_HASH_DRIFT,
      detail: `source hash drift: ${contract.path}`,
    })
    sourceSha256ByPath[contract.path] = sourceSha256
  }

  const overlayContract = certificate.sourceContracts.overlayDescriptor
  const overlay = parseManagedOverlayDescriptor(
    parseJson(requireSource(input.sourceTexts, overlayContract.path), overlayContract.path),
  )
  requireBound({
    actual: overlay.overlay.planSha256,
    expected: EXPECTED_OVERLAY_PLAN_SHA256,
    code: RUNTIME_SCOPE_ERROR_CODE.OVERLAY_BINDING_DRIFT,
    detail: "overlay plan binding drift",
  })
  requireBound({
    actual: overlay.overlay.planSha256,
    expected: certificate.overlayPlanSha256,
    code: RUNTIME_SCOPE_ERROR_CODE.OVERLAY_BINDING_DRIFT,
    detail: "certificate overlay binding drift",
  })

  const lockContract = certificate.sourceContracts.upstreamLock
  const lock = parseUpstreamLock(
    parseJson(requireSource(input.sourceTexts, lockContract.path), lockContract.path),
  )
  if (lock.lockStage !== LOCK_STAGE.CORPUS_LOCKED) {
    fail(RUNTIME_SCOPE_ERROR_CODE.UPSTREAM_LOCK_STAGE_DRIFT, "upstream lock is not corpus-locked")
  }
  requireBound({
    actual: lock.protocolCorpusSha256,
    expected: certificate.sourceContracts.protocolCorpus.sha256,
    code: RUNTIME_SCOPE_ERROR_CODE.CORPUS_BINDING_DRIFT,
    detail: "protocol corpus binding drift",
  })
  requireBound({
    actual: lock.sessionIdVerdictSha256,
    expected: certificate.sourceContracts.sessionIdVerdict.sha256,
    code: RUNTIME_SCOPE_ERROR_CODE.CORPUS_BINDING_DRIFT,
    detail: "session verdict binding drift",
  })
  requireBound({
    actual: lock.upstreamSha,
    expected: overlay.corpus.upstreamSha,
    code: RUNTIME_SCOPE_ERROR_CODE.CORPUS_BINDING_DRIFT,
    detail: "upstream source binding drift",
  })

  return {
    overlayPlanSha256: certificate.overlayPlanSha256,
    capacityStatus: certificate.capacityStatus,
    proofLevel: certificate.proofLevel,
    workerPoolIds: certificate.workerPools.map(({ poolId }) => poolId),
    scopedWorkerIds: certificate.workerPools.flatMap(({ scopedWorkerIds }) => scopedWorkerIds),
    sourceSha256ByPath,
  }
}
