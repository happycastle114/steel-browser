import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const RULESET_CONTRACT = Object.freeze({
  ACTIVE: "active",
  BRANCH: "branch",
  MANAGED_REF: "refs/heads/managed",
  CANDIDATE_REF: "refs/heads/upstream-sync/**",
  REQUIRED_CHECK: "Managed pull request gates / gates",
  DELETION: "deletion",
  NON_FAST_FORWARD: "non_fast_forward",
  UPDATE: "update",
  PULL_REQUEST: "pull_request",
  REQUIRED_STATUS_CHECKS: "required_status_checks",
  ALLOWED_MERGE_METHODS: Object.freeze(["merge"]),
  REQUIRED_APPROVING_REVIEWS: 1,
  REQUIRE_CODE_OWNER_REVIEW: true,
  REQUIRE_REVIEW_THREAD_RESOLUTION: true,
  DISMISS_STALE_REVIEWS: true,
  REQUIRE_LAST_PUSH_APPROVAL: false,
})

function flattenRulesets(value) {
  if (!Array.isArray(value)) throw new Error("GitHub rulesets response must be an array")
  return value.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
}

function hasRule(ruleset, type) {
  return Array.isArray(ruleset.rules) && ruleset.rules.some((rule) => rule?.type === type)
}

function hasRef(ruleset, ref) {
  return Array.isArray(ruleset.conditions?.ref_name?.include) && ruleset.conditions.ref_name.include.includes(ref)
}

function hasNoBypassActors(ruleset) {
  return Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length === 0
}

function hasManagedPullRequestPolicy(ruleset) {
  const rule = ruleset.rules?.find((candidate) => candidate?.type === RULESET_CONTRACT.PULL_REQUEST)
  const parameters = rule?.parameters
  if (parameters === undefined || !Array.isArray(parameters.allowed_merge_methods)) return false
  return parameters.allowed_merge_methods.length === RULESET_CONTRACT.ALLOWED_MERGE_METHODS.length &&
    parameters.allowed_merge_methods.every((method, index) => method === RULESET_CONTRACT.ALLOWED_MERGE_METHODS[index]) &&
    parameters.dismiss_stale_reviews_on_push === RULESET_CONTRACT.DISMISS_STALE_REVIEWS &&
    parameters.require_code_owner_review === RULESET_CONTRACT.REQUIRE_CODE_OWNER_REVIEW &&
    parameters.required_review_thread_resolution === RULESET_CONTRACT.REQUIRE_REVIEW_THREAD_RESOLUTION &&
    parameters.required_approving_review_count === RULESET_CONTRACT.REQUIRED_APPROVING_REVIEWS &&
    parameters.require_last_push_approval === RULESET_CONTRACT.REQUIRE_LAST_PUSH_APPROVAL
}

function hasManagedRequiredCheck(ruleset) {
  const rule = ruleset.rules?.find((candidate) => candidate?.type === RULESET_CONTRACT.REQUIRED_STATUS_CHECKS)
  if (rule === undefined) return false
  if (rule.parameters?.strict_required_status_checks_policy !== true) return false
  return Array.isArray(rule.parameters.required_status_checks) && rule.parameters.required_status_checks.some((check) => check?.context === RULESET_CONTRACT.REQUIRED_CHECK)
}

function requireRuleset(rulesets, predicate, detail) {
  const match = rulesets.find((ruleset) => ruleset.enforcement === RULESET_CONTRACT.ACTIVE && ruleset.target === RULESET_CONTRACT.BRANCH && predicate(ruleset))
  if (match === undefined) throw new Error(detail)
  return match
}

export async function loadRepositoryRulesets(repository, execute = execFileAsync) {
  const listResult = await execute("gh", ["api", `repos/${repository}/rulesets`, "--paginate", "--slurp"], { env: { ...process.env, GH_PAGER: "cat" }, maxBuffer: 8 * 1024 * 1024 })
  const listed = flattenRulesets(JSON.parse(listResult.stdout))
  if (listed.length === 0) throw new Error("GitHub returned no repository rulesets")
  const details = []
  for (const ruleset of listed) {
    if (!Number.isInteger(ruleset.id) && typeof ruleset.id !== "string") throw new Error("GitHub ruleset list entry has no stable id")
    const detailResult = await execute("gh", ["api", `repos/${repository}/rulesets/${ruleset.id}`], { env: { ...process.env, GH_PAGER: "cat" }, maxBuffer: 8 * 1024 * 1024 })
    details.push(JSON.parse(detailResult.stdout))
  }
  return details
}

export function verifyRepositoryRules(rulesetsInput) {
  const rulesets = flattenRulesets(rulesetsInput)
  requireRuleset(rulesets, (ruleset) => hasRef(ruleset, RULESET_CONTRACT.MANAGED_REF) && hasNoBypassActors(ruleset) && hasRule(ruleset, RULESET_CONTRACT.DELETION) && hasRule(ruleset, RULESET_CONTRACT.NON_FAST_FORWARD) && hasManagedPullRequestPolicy(ruleset) && hasManagedRequiredCheck(ruleset), "managed branch ruleset must enforce zero bypass actors, exact pull request review policy, deletion, non-fast-forward, and the managed gate check")
  requireRuleset(rulesets, (ruleset) => hasRef(ruleset, RULESET_CONTRACT.CANDIDATE_REF) && hasNoBypassActors(ruleset) && hasRule(ruleset, RULESET_CONTRACT.DELETION) && hasRule(ruleset, RULESET_CONTRACT.NON_FAST_FORWARD) && hasRule(ruleset, RULESET_CONTRACT.UPDATE), "upstream-sync candidate refs must be protected against bypass actors, deletion, non-fast-forward updates, and unreviewed updates")
  return { status: "VERIFIED", managedCheck: RULESET_CONTRACT.REQUIRED_CHECK, candidateRef: RULESET_CONTRACT.CANDIDATE_REF }
}

async function main() {
  const args = process.argv.slice(2)
  const repositoryIndex = args.indexOf("--repository")
  const repository = repositoryIndex === -1 ? undefined : args[repositoryIndex + 1]
  if (repository === undefined || repository.trim() === "") throw new Error("usage: verify-repository-rules.mjs --repository <owner/repository>")
  const details = await loadRepositoryRulesets(repository)
  console.log(`UPSTREAM_SYNC_REPOSITORY_RULES_VERIFIED ${JSON.stringify(verifyRepositoryRules(details))}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown repository rules verification failure")
    process.exitCode = 1
  })
}
