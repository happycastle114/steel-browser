import { z } from "zod"

import { MANAGED_SECRET_ENVIRONMENT_KEY } from "./fingerprint-receipt-vocabulary.js"
import { FingerprintProofSchema } from "./fingerprint-receipt.js"
import { ManagerInitContractFixtureSchema } from "./manager-init-schema.js"
import { MANAGER_STATUS_CAP_FIELD } from "./manager-init-vocabulary.js"
import { RuntimeScopeCertificateSchema } from "./runtime-scope.js"
import {
  RUNTIME_SCOPE_MUTATION,
  RUNTIME_SCOPE_MUTATION_STATUS,
} from "./runtime-scope-fixture-vocabulary.js"

const MutationSchema = z.nativeEnum(RUNTIME_SCOPE_MUTATION)

export type RuntimeScopeMutationInput = Readonly<{
  readonly mutationInputs: readonly unknown[]
  readonly certificateInput: unknown
  readonly managerInitInput: unknown
  readonly stoppedRuntimeProofInput: unknown
}>

export type RuntimeScopeMutationResult = Readonly<{
  readonly mutation: (typeof RUNTIME_SCOPE_MUTATION)[keyof typeof RUNTIME_SCOPE_MUTATION]
  readonly status: typeof RUNTIME_SCOPE_MUTATION_STATUS.REJECTED
}>

export class RuntimeScopeMutationAcceptedError extends Error {
  public override readonly name = "RuntimeScopeMutationAcceptedError"

  public constructor(public readonly mutation: string) {
    super(`runtime-scope mutation was accepted: ${mutation}`)
  }
}

function initMutationRejected(
  mutation: (typeof RUNTIME_SCOPE_MUTATION)[keyof typeof RUNTIME_SCOPE_MUTATION],
  input: ReturnType<typeof ManagerInitContractFixtureSchema.parse>,
): boolean {
  switch (mutation) {
    case RUNTIME_SCOPE_MUTATION.WORKER_SECRET:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        secretSource: {
          ...input.secretSource,
          workerReadPaths: [input.finalSecret.path],
        },
      }).success
    case RUNTIME_SCOPE_MUTATION.SECRET_ENV:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        compose: {
          ...input.compose,
          serviceEnvironmentKeys: {
            ...input.compose.serviceEnvironmentKeys,
            manager: [MANAGED_SECRET_ENVIRONMENT_KEY],
          },
        },
      }).success
    case RUNTIME_SCOPE_MUTATION.PARSED_COMPOSE:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        compose: { ...input.compose, deploymentMode: "PARSED" },
      }).success
    case RUNTIME_SCOPE_MUTATION.NONROOT_INIT:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        initialProcess: { ...input.initialProcess, uid: 10_001 },
      }).success
    case RUNTIME_SCOPE_MUTATION.SOURCE_DIR_TRAVERSABLE:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        secretSource: { ...input.secretSource, traversableByFinalManager: true },
      }).success
    case RUNTIME_SCOPE_MUTATION.MISSING_CLOEXEC:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        openRecords: [
          { ...input.openRecords[0], flags: ["O_RDONLY", "O_NOFOLLOW"] },
          input.openRecords[1],
        ],
      }).success
    case RUNTIME_SCOPE_MUTATION.INHERITED_SOURCE_FD:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        openRecords: [
          { ...input.openRecords[0], closedBeforePrivilegeDrop: false },
          input.openRecords[1],
        ],
      }).success
    case RUNTIME_SCOPE_MUTATION.INHERITED_DESTINATION_FD:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        openRecords: [
          input.openRecords[0],
          { ...input.openRecords[1], closedBeforePrivilegeDrop: false },
        ],
      }).success
    case RUNTIME_SCOPE_MUTATION.MISSING_SETPCAP:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        initialProcess: {
          ...input.initialProcess,
          capabilities: input.initialProcess.capabilities.slice(0, 3),
        },
      }).success
    case RUNTIME_SCOPE_MUTATION.WRONG_DROP_ORDER:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        initTrace: [
          ...input.initTrace.slice(0, 9),
          input.initTrace[10],
          input.initTrace[9],
          ...input.initTrace.slice(11),
        ],
      }).success
    case RUNTIME_SCOPE_MUTATION.NONZERO_CAPINH:
      return nonzeroCapabilityRejected(input, MANAGER_STATUS_CAP_FIELD.INHERITABLE)
    case RUNTIME_SCOPE_MUTATION.NONZERO_CAPPRM:
      return nonzeroCapabilityRejected(input, MANAGER_STATUS_CAP_FIELD.PERMITTED)
    case RUNTIME_SCOPE_MUTATION.NONZERO_CAPEFF:
      return nonzeroCapabilityRejected(input, MANAGER_STATUS_CAP_FIELD.EFFECTIVE)
    case RUNTIME_SCOPE_MUTATION.NONZERO_CAPBND:
      return nonzeroCapabilityRejected(input, MANAGER_STATUS_CAP_FIELD.BOUNDING)
    case RUNTIME_SCOPE_MUTATION.NONZERO_CAPAMB:
      return nonzeroCapabilityRejected(input, MANAGER_STATUS_CAP_FIELD.AMBIENT)
    case RUNTIME_SCOPE_MUTATION.SUPPLEMENTARY_GROUP:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        finalStatus: { ...input.finalStatus, supplementaryGroups: [10_001] },
      }).success
    case RUNTIME_SCOPE_MUTATION.NO_NEW_PRIVS:
      return !ManagerInitContractFixtureSchema.safeParse({
        ...input,
        finalStatus: { ...input.finalStatus, noNewPrivs: 0 },
      }).success
    default:
      return false
  }
}

function nonzeroCapabilityRejected(
  input: ReturnType<typeof ManagerInitContractFixtureSchema.parse>,
  field: (typeof MANAGER_STATUS_CAP_FIELD)[keyof typeof MANAGER_STATUS_CAP_FIELD],
): boolean {
  return !ManagerInitContractFixtureSchema.safeParse({
    ...input,
    finalStatus: {
      ...input.finalStatus,
      capabilities: { ...input.finalStatus.capabilities, [field]: "0000000000000001" },
    },
  }).success
}

type MutationContext = Readonly<{
  readonly mutation: (typeof RUNTIME_SCOPE_MUTATION)[keyof typeof RUNTIME_SCOPE_MUTATION]
  readonly certificate: ReturnType<typeof RuntimeScopeCertificateSchema.parse>
  readonly init: ReturnType<typeof ManagerInitContractFixtureSchema.parse>
  readonly stoppedRuntimeProofInput: unknown
}>

function mutationRejected(context: MutationContext): boolean {
  switch (context.mutation) {
    case RUNTIME_SCOPE_MUTATION.REPLICA_DNS:
      return !RuntimeScopeCertificateSchema.safeParse({ ...context.certificate, discoveryMode: "DNS_REPLICA" }).success
    case RUNTIME_SCOPE_MUTATION.WORKER_OVERLAP:
      return !RuntimeScopeCertificateSchema.safeParse({
        ...context.certificate,
        workerPools: [context.certificate.workerPools[0], context.certificate.workerPools[0]],
      }).success
    case RUNTIME_SCOPE_MUTATION.STOPPED_RUNTIME_PROOF:
      return !FingerprintProofSchema.safeParse(context.stoppedRuntimeProofInput).success
    case RUNTIME_SCOPE_MUTATION.STALE_OVERLAY:
      return !RuntimeScopeCertificateSchema.safeParse({
        ...context.certificate,
        overlayPlanSha256: "0".repeat(64),
      }).success
    case RUNTIME_SCOPE_MUTATION.LIVE_CAPACITY_CLAIM:
      return !RuntimeScopeCertificateSchema.safeParse({
        ...context.certificate,
        capacityStatus: "VERIFIED",
      }).success
    default:
      return initMutationRejected(context.mutation, context.init)
  }
}

export function evaluateRuntimeScopeMutations(
  input: RuntimeScopeMutationInput,
): readonly RuntimeScopeMutationResult[] {
  const certificate = RuntimeScopeCertificateSchema.parse(input.certificateInput)
  const init = ManagerInitContractFixtureSchema.parse(input.managerInitInput)
  return input.mutationInputs.map((mutationInput) => {
    const mutation = MutationSchema.parse(mutationInput)
    if (!mutationRejected({
      mutation,
      certificate,
      init,
      stoppedRuntimeProofInput: input.stoppedRuntimeProofInput,
    })) {
      throw new RuntimeScopeMutationAcceptedError(mutation)
    }
    return { mutation, status: RUNTIME_SCOPE_MUTATION_STATUS.REJECTED }
  })
}
