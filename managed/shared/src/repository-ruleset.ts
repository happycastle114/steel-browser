import { z } from "zod"

export const RULESET_ENFORCEMENT = {
  ACTIVE: "active",
} as const

export const RULESET_TARGET = {
  BRANCH: "branch",
} as const

export const RULESET_NAME = {
  MAIN_MIRROR: "main mirror integrity",
  MANAGED: "managed reviewed changes",
  UPSTREAM_SYNC_CANDIDATE: "upstream sync candidate integrity",
} as const

export const BRANCH_REF = {
  MAIN: "refs/heads/main",
  MANAGED: "refs/heads/managed",
  UPSTREAM_SYNC_CANDIDATE: "refs/heads/upstream-sync/**",
} as const

export const REPOSITORY_RULE = {
  DELETION: "deletion",
  NON_FAST_FORWARD: "non_fast_forward",
  PULL_REQUEST: "pull_request",
  REQUIRED_STATUS_CHECKS: "required_status_checks",
  UPDATE: "update",
} as const

export const REQUIRED_STATUS_CHECK_CONTEXT = "Managed pull request gates / gates" as const

export const MERGE_METHOD = {
  MERGE: "merge",
} as const

const DeletionRuleSchema = z.object({ type: z.literal(REPOSITORY_RULE.DELETION) }).strict()
const NonFastForwardRuleSchema = z
  .object({ type: z.literal(REPOSITORY_RULE.NON_FAST_FORWARD) })
  .strict()
const UpdateRuleSchema = z
  .object({
    type: z.literal(REPOSITORY_RULE.UPDATE),
    parameters: z.object({ update_allows_fetch_and_merge: z.literal(false) }).strict(),
  })
  .strict()
const PullRequestRuleSchema = z
  .object({
    type: z.literal(REPOSITORY_RULE.PULL_REQUEST),
    parameters: z
      .object({
        allowed_merge_methods: z.tuple([z.literal(MERGE_METHOD.MERGE)]),
        dismiss_stale_reviews_on_push: z.literal(true),
        require_code_owner_review: z.literal(true),
        require_last_push_approval: z.literal(false),
        required_approving_review_count: z.literal(1),
        required_review_thread_resolution: z.literal(true),
      })
      .strict(),
  })
  .strict()
const RequiredStatusChecksRuleSchema = z
  .object({
    type: z.literal(REPOSITORY_RULE.REQUIRED_STATUS_CHECKS),
    parameters: z
      .object({
        strict_required_status_checks_policy: z.literal(true),
        required_status_checks: z
          .array(z.object({ context: z.literal(REQUIRED_STATUS_CHECK_CONTEXT), integration_id: z.number().int().positive().nullable() }).strict())
          .nonempty(),
      })
      .strict(),
  })
  .strict()

const rulesetBase = {
  target: z.literal(RULESET_TARGET.BRANCH),
  enforcement: z.literal(RULESET_ENFORCEMENT.ACTIVE),
  bypass_actors: z.tuple([]),
}

const MainMirrorRulesetSchema = z
  .object({
    ...rulesetBase,
    name: z.literal(RULESET_NAME.MAIN_MIRROR),
    conditions: z
      .object({
        ref_name: z
          .object({ include: z.tuple([z.literal(BRANCH_REF.MAIN)]), exclude: z.tuple([]) })
          .strict(),
      })
      .strict(),
    rules: z.tuple([DeletionRuleSchema, NonFastForwardRuleSchema]),
  })
  .strict()

const ManagedRulesetSchema = z
  .object({
    ...rulesetBase,
    name: z.literal(RULESET_NAME.MANAGED),
    conditions: z
      .object({
        ref_name: z
          .object({ include: z.tuple([z.literal(BRANCH_REF.MANAGED)]), exclude: z.tuple([]) })
          .strict(),
      })
      .strict(),
    rules: z.tuple([DeletionRuleSchema, NonFastForwardRuleSchema, PullRequestRuleSchema, RequiredStatusChecksRuleSchema]),
  })
  .strict()

const UpstreamSyncCandidateRulesetSchema = z
  .object({
    ...rulesetBase,
    name: z.literal(RULESET_NAME.UPSTREAM_SYNC_CANDIDATE),
    conditions: z
      .object({
        ref_name: z
          .object({ include: z.tuple([z.literal(BRANCH_REF.UPSTREAM_SYNC_CANDIDATE)]), exclude: z.tuple([]) })
          .strict(),
      })
      .strict(),
    rules: z.tuple([DeletionRuleSchema, NonFastForwardRuleSchema, UpdateRuleSchema]),
  })
  .strict()

export const RepositoryRulesetSchema = z.union([MainMirrorRulesetSchema, ManagedRulesetSchema, UpstreamSyncCandidateRulesetSchema])

export type RepositoryRuleset = Readonly<z.infer<typeof RepositoryRulesetSchema>>

export function parseRepositoryRuleset(input: unknown): RepositoryRuleset {
  return RepositoryRulesetSchema.parse(input)
}
