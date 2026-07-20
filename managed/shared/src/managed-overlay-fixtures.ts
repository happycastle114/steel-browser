import {
  EXPECTED_CORPUS_COMMIT,
  OVERLAY_ERROR_CODE,
  OVERLAY_FIXTURE,
  OVERLAY_FIXTURE_KIND,
  OVERLAY_LINEAGE_FIXTURE,
  FIXTURE_EVALUATION_STATUS,
} from "./managed-overlay-catalog.js"
import {
  assertExactOverlayLineage,
  lineageErrorCodeForFixture,
  type OverlayLineageFacts,
} from "./managed-overlay-lineage.js"
import { ManagedOverlayVerificationError, type OverlayErrorCode } from "./managed-overlay-errors.js"
import {
  OverlayDescriptorSchema,
  OverlayFixtureSchema,
  type DescriptorFixture,
  type LineageFixture,
  type ManagedOverlayDescriptor,
  type OverlayFixture,
} from "./managed-overlay-schema.js"
import { verifyManagedOverlayDescriptor } from "./managed-overlay-verifier.js"

export { OVERLAY_FIXTURE }
export type { OverlayFixture }

export type FixtureEvaluation =
  | Readonly<{ status: typeof FIXTURE_EVALUATION_STATUS.REJECTED; code: OverlayErrorCode; detail: string }>
  | Readonly<{ status: typeof FIXTURE_EVALUATION_STATUS.ACCEPTED }>

export function parseOverlayFixture(input: unknown): OverlayFixture {
  return OverlayFixtureSchema.parse(input)
}

export function applyDescriptorFixture(descriptor: ManagedOverlayDescriptor, fixture: DescriptorFixture): unknown {
  switch (fixture.mutation) {
    case OVERLAY_FIXTURE.WRONG_PARENT_SHA:
      return { ...descriptor, overlay: { ...descriptor.overlay, parentPlanSha256: "0".repeat(64) } }
    case OVERLAY_FIXTURE.MISSING_SUPERSESSION:
      return { ...descriptor, supersession: descriptor.supersession.slice(0, -1) }
    case OVERLAY_FIXTURE.WRONG_CORPUS:
      return { ...descriptor, corpus: { ...descriptor.corpus, commit: "0".repeat(40) } }
    case OVERLAY_FIXTURE.MISSING_SECONDARY_PR_AUTHOR: {
      const { secondaryPrAuthor: _secondaryPrAuthor, ...reviewPolicy } = descriptor.reviewPolicy
      return { ...descriptor, reviewPolicy }
    }
    case OVERLAY_FIXTURE.MISSING_CODEOWNER_APPROVAL:
      return { ...descriptor, reviewPolicy: { ...descriptor.reviewPolicy, requiredCodeOwnerApproval: false } }
    default:
      return assertNever(fixture.mutation)
  }
}

function lineageFixtureFacts(fixture: LineageFixture): OverlayLineageFacts {
  const valid: OverlayLineageFacts = {
    head: "f".repeat(40),
    parentCommits: [EXPECTED_CORPUS_COMMIT],
    worktreeClean: true,
    indexClean: true,
    baseIsAncestor: true,
    overlayDiffPresent: true,
  }
  switch (fixture.mutation) {
    case OVERLAY_LINEAGE_FIXTURE.DIRTY_UNSTAGED:
      return { ...valid, worktreeClean: false }
    case OVERLAY_LINEAGE_FIXTURE.DIRTY_INDEX:
      return { ...valid, indexClean: false }
    case OVERLAY_LINEAGE_FIXTURE.INTERMEDIATE_HEAD:
      return { ...valid, parentCommits: ["e".repeat(40)] }
    case OVERLAY_LINEAGE_FIXTURE.MERGE_HEAD:
      return { ...valid, parentCommits: [EXPECTED_CORPUS_COMMIT, "e".repeat(40)] }
    default:
      return assertNever(fixture.mutation)
  }
}

export function evaluateOverlayFixture(
  descriptor: ManagedOverlayDescriptor,
  fixture: OverlayFixture,
): FixtureEvaluation {
  try {
    if (fixture.kind === OVERLAY_FIXTURE_KIND.DESCRIPTOR) {
      const parsed = OverlayDescriptorSchema.parse(applyDescriptorFixture(descriptor, fixture))
      verifyManagedOverlayDescriptor(parsed)
      return { status: FIXTURE_EVALUATION_STATUS.ACCEPTED }
    }
    try {
      assertExactOverlayLineage(lineageFixtureFacts(fixture))
      return { status: FIXTURE_EVALUATION_STATUS.ACCEPTED }
    } catch (error) {
      if (error instanceof ManagedOverlayVerificationError) {
        return { status: FIXTURE_EVALUATION_STATUS.REJECTED, code: error.code, detail: error.detail }
      }
      throw error
    }
  } catch (error) {
    if (error instanceof ManagedOverlayVerificationError) {
      return { status: FIXTURE_EVALUATION_STATUS.REJECTED, code: error.code, detail: error.detail }
    }
    if (error instanceof Error) {
      return { status: FIXTURE_EVALUATION_STATUS.REJECTED, code: OVERLAY_ERROR_CODE.DESCRIPTOR_SCHEMA, detail: error.message }
    }
    throw error
  }
}

export function expectedLineageFixtureCode(fixture: LineageFixture): OverlayErrorCode {
  return lineageErrorCodeForFixture(fixture.mutation)
}

function assertNever(value: never): never {
  throw new Error(`unsupported overlay fixture: ${String(value)}`)
}
