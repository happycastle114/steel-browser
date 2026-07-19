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
} as const

export const BRANCH_REF = {
  MAIN: "refs/heads/main",
  MANAGED: "refs/heads/managed",
} as const

export const REPOSITORY_RULE = {
  DELETION: "deletion",
  NON_FAST_FORWARD: "non_fast_forward",
  PULL_REQUEST: "pull_request",
} as const

export const MERGE_METHOD = {
  MERGE: "merge",
} as const

const DeletionRuleSchema = z.object({ type: z.literal(REPOSITORY_RULE.DELETION) }).strict()
const NonFastForwardRuleSchema = z
  .object({ type: z.literal(REPOSITORY_RULE.NON_FAST_FORWARD) })
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
    rules: z.tuple([DeletionRuleSchema, NonFastForwardRuleSchema, PullRequestRuleSchema]),
  })
  .strict()

export const RepositoryRulesetSchema = z.union([MainMirrorRulesetSchema, ManagedRulesetSchema])

export type RepositoryRuleset = Readonly<z.infer<typeof RepositoryRulesetSchema>>

export function parseRepositoryRuleset(input: unknown): RepositoryRuleset {
  return RepositoryRulesetSchema.parse(input)
}
