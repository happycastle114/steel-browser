import {
  ManagerInitContractFixtureSchema,
  ManagerInitVerificationSurfaceSchema,
  type ManagerInitContractFixture,
} from "./manager-init-schema.js"
import {
  MANAGER_INIT_ERROR_CODE,
  MANAGER_INIT_SEQUENCE,
  MANAGER_INIT_VERIFICATION_RESULT_KIND,
  MANAGER_INIT_VERIFICATION_SURFACE,
  REQUIRED_MANAGER_STATUS_CAP_FIELDS,
} from "./manager-init-vocabulary.js"

export { MANAGER_INIT_SEQUENCE }
export { ManagerInitContractFixtureSchema }

type ManagerInitErrorCode =
  (typeof MANAGER_INIT_ERROR_CODE)[keyof typeof MANAGER_INIT_ERROR_CODE]

export class ManagerInitVerificationError extends Error {
  public override readonly name = "ManagerInitVerificationError"

  public constructor(
    public readonly code: ManagerInitErrorCode,
    detail: string,
  ) {
    super(detail)
  }
}

export type ManagerInitContractVerificationInput = Readonly<{
  readonly fixtureInput: unknown
}>

export type ManagerInitConfigBoundVerification = Readonly<{
  readonly kind: typeof MANAGER_INIT_VERIFICATION_RESULT_KIND.CONFIG_BOUND
  readonly verificationSurface: ManagerInitContractFixture["verificationSurface"]
  readonly proofLevel: ManagerInitContractFixture["proofLevel"]
  readonly initialUid: 0
  readonly finalUid: 10_001
  readonly finalGid: 10_001
  readonly capabilityFields: typeof REQUIRED_MANAGER_STATUS_CAP_FIELDS
  readonly secretDescriptorsClosed: true
  readonly destinationMount: ManagerInitContractFixture["destinationMount"]
  readonly executionReceipt: ManagerInitContractFixture["executionReceipt"]
}>

export type ManagerInitLiveProofDeferred = Readonly<{
  readonly kind: typeof MANAGER_INIT_VERIFICATION_RESULT_KIND.LIVE_PROOF_DEFERRED_TO_TASK_41
  readonly requestedSurface: typeof MANAGER_INIT_VERIFICATION_SURFACE.LIVE_LINUX
}>

export type ManagerInitContractVerification =
  | ManagerInitConfigBoundVerification
  | ManagerInitLiveProofDeferred

function assertNever(value: never): never {
  return value
}

export function verifyManagerInitContractFixture(
  input: ManagerInitContractVerificationInput,
): ManagerInitContractVerification {
  const surface = ManagerInitVerificationSurfaceSchema.parse(input.fixtureInput)
  switch (surface.verificationSurface) {
    case MANAGER_INIT_VERIFICATION_SURFACE.SYNTHETIC_CONTRACT:
      break
    case MANAGER_INIT_VERIFICATION_SURFACE.LIVE_LINUX:
      return deferLiveManagerInitVerification()
    default:
      return assertNever(surface.verificationSurface)
  }
  const fixture = ManagerInitContractFixtureSchema.parse(input.fixtureInput)
  return {
    kind: MANAGER_INIT_VERIFICATION_RESULT_KIND.CONFIG_BOUND,
    verificationSurface: fixture.verificationSurface,
    proofLevel: fixture.proofLevel,
    initialUid: 0,
    finalUid: 10_001,
    finalGid: 10_001,
    capabilityFields: REQUIRED_MANAGER_STATUS_CAP_FIELDS,
    secretDescriptorsClosed: true,
    destinationMount: fixture.destinationMount,
    executionReceipt: fixture.executionReceipt,
  }
}

export function deferLiveManagerInitVerification(): ManagerInitLiveProofDeferred {
  return {
    kind: MANAGER_INIT_VERIFICATION_RESULT_KIND.LIVE_PROOF_DEFERRED_TO_TASK_41,
    requestedSurface: MANAGER_INIT_VERIFICATION_SURFACE.LIVE_LINUX,
  }
}
