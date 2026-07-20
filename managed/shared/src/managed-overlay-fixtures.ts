import { ManagedOverlayVerificationError } from "./managed-overlay-verifier.js"
import { type ManagedOverlayDescriptor, OverlayFixtureSchema, type OverlayFixture } from "./managed-overlay-schema.js"
import { OVERLAY_FIXTURE } from "./managed-overlay-catalog.js"

export { OVERLAY_FIXTURE }

export type { OverlayFixture }

export function parseOverlayFixture(input: unknown): OverlayFixture {
  return OverlayFixtureSchema.parse(input)
}

export function applyOverlayFixture(
  descriptor: ManagedOverlayDescriptor,
  fixture: OverlayFixture,
): ManagedOverlayDescriptor {
  switch (fixture.mutation) {
    case OVERLAY_FIXTURE.WRONG_PARENT_SHA:
      return {
        ...descriptor,
        overlay: { ...descriptor.overlay, parentPlanSha256: "0".repeat(64) },
      }
    case OVERLAY_FIXTURE.MISSING_SUPERSESSION:
      return { ...descriptor, supersession: descriptor.supersession.slice(0, -1) } as unknown as ManagedOverlayDescriptor
    case OVERLAY_FIXTURE.WRONG_CORPUS:
      return { ...descriptor, corpus: { ...descriptor.corpus, commit: "0".repeat(40) } }
    case OVERLAY_FIXTURE.MISSING_SECONDARY_PR_AUTHOR: {
      const { secondaryPrAuthor: _secondaryPrAuthor, ...reviewPolicy } = descriptor.reviewPolicy
      return { ...descriptor, reviewPolicy: reviewPolicy as ManagedOverlayDescriptor["reviewPolicy"] } as unknown as ManagedOverlayDescriptor
    }
    case OVERLAY_FIXTURE.MISSING_CODEOWNER_APPROVAL:
      return {
        ...descriptor,
        reviewPolicy: { ...descriptor.reviewPolicy, requiredCodeOwnerApproval: false },
      } as unknown as ManagedOverlayDescriptor
    default:
      return assertNever(fixture.mutation)
  }
}

function assertNever(value: never): never {
  throw new ManagedOverlayVerificationError(`unsupported overlay fixture: ${String(value)}`)
}
