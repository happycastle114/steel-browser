import { z } from "zod"

import {
  DISCOVERY_MODE,
  EXPECTED_OVERLAY_ID,
  EXPECTED_OVERLAY_PLAN_FILE,
  EXPECTED_PARENT_PLAN_FILE,
  OVERLAY_FIXTURE,
  OVERLAY_BINDING,
  OVERLAY_KIND,
  REVIEW_MERGE_METHOD,
  REVIEW_STEP,
  SUPERSESSION_MODE,
} from "./managed-overlay-catalog.js"

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/u)
const NonEmptyStringSchema = z.string().min(1)

export const OverlayDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(OVERLAY_KIND.STEEL_MANAGED_OVERLAY),
    overlay: z
      .object({
        id: z.literal(EXPECTED_OVERLAY_ID),
        planFile: z.literal(EXPECTED_OVERLAY_PLAN_FILE),
        planSha256: Sha256Schema,
        parentPlanFile: z.literal(EXPECTED_PARENT_PLAN_FILE),
        parentPlanSha256: Sha256Schema,
        binding: z.literal(OVERLAY_BINDING.BIND_PARENT_PLAN),
      })
      .strict(),
    corpus: z
      .object({
        commit: GitCommitSchema,
        baseCommit: GitCommitSchema,
        upstreamSha: GitCommitSchema,
        lockPath: NonEmptyStringSchema,
        protocolCorpusSha256: Sha256Schema,
        sessionIdVerdictSha256: Sha256Schema,
        observedReceiptSha256: Sha256Schema,
      })
      .strict(),
    enums: z.record(z.string().min(1), z.array(NonEmptyStringSchema).nonempty()),
    supersession: z
      .array(
        z
          .object({
            parentItem: NonEmptyStringSchema,
            mode: z.enum([
              SUPERSESSION_MODE.RETAIN,
              SUPERSESSION_MODE.AMEND,
              SUPERSESSION_MODE.REPLACE,
            ]),
            authority: NonEmptyStringSchema,
          })
          .strict(),
      )
      .nonempty(),
    dependencies: z
      .array(
        z
          .object({
            todo: NonEmptyStringSchema,
            dependsOn: z.array(NonEmptyStringSchema),
            blocks: z.array(NonEmptyStringSchema),
            parallelWith: z.array(NonEmptyStringSchema),
          })
          .strict(),
      )
      .nonempty(),
    reviewPolicy: z
      .object({
        protectedBranch: z.literal("managed"),
        primaryCodeOwner: z.literal("happycastle114"),
        secondaryPrAuthor: z.literal("soungminsonus-art"),
        requiredIndependentReview: z.literal(true),
        requiredCodeOwnerApproval: z.literal(true),
        requiredApprovingReviewCount: z.literal(1),
        allowedMergeMethod: z.literal(REVIEW_MERGE_METHOD.MERGE),
        bypassActors: z.tuple([]),
        sequence: z.array(
          z
            .object({
              step: z.enum([
                REVIEW_STEP.PUSH_FEATURE,
                REVIEW_STEP.OPEN_SECONDARY_AUTHORED_PR,
                REVIEW_STEP.RESTORE_PRIMARY_AUTH,
                REVIEW_STEP.INDEPENDENT_REVIEW,
                REVIEW_STEP.CODE_OWNER_APPROVAL,
                REVIEW_STEP.MERGE,
              ]),
              actor: NonEmptyStringSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    guardrails: z
      .object({
        maxConcurrentManagedProjects: z.literal(1),
        activeWorkerCount: z.literal(2),
        discoveryMode: z.literal(DISCOVERY_MODE.STATIC_CONFIG),
        cutoverMode: z.literal("SERIAL_MAINTENANCE"),
        composeDeploymentMode: z.literal("RAW_EXPLICIT_PROXY"),
        secretIsolationMode: z.literal("RAW_COMPOSE_MANAGER_SECRET"),
        legacyQuiescenceMode: z.literal("MAINTENANCE_NO_ORIGIN"),
        publicWorkerPorts: z.tuple([]),
        publicDebugPorts: z.tuple([]),
      })
      .strict(),
  })
  .strict()

export type ManagedOverlayDescriptor = Readonly<z.infer<typeof OverlayDescriptorSchema>>

export const OverlayFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    mutation: z.enum([
      OVERLAY_FIXTURE.WRONG_PARENT_SHA,
      OVERLAY_FIXTURE.MISSING_SUPERSESSION,
      OVERLAY_FIXTURE.WRONG_CORPUS,
      OVERLAY_FIXTURE.MISSING_SECONDARY_PR_AUTHOR,
      OVERLAY_FIXTURE.MISSING_CODEOWNER_APPROVAL,
    ]),
  })
  .strict()

export type OverlayFixture = Readonly<z.infer<typeof OverlayFixtureSchema>>
