import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
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

export const REPOSITORY_RULES_ERROR = Object.freeze({
  REQUIRED_STATUS_CHECK_CONTEXT_MISSING: "REQUIRED_STATUS_CHECK_CONTEXT_MISSING",
})

export class RepositoryRulesError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "RepositoryRulesError"
    this.code = code
  }
}

export function parseRequiredCheckContract(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["context", "integrationId", "schemaVersion"].sort()) || value.schemaVersion !== 1 || value.context !== RULESET_CONTRACT.REQUIRED_CHECK) {
    throw new Error("managed required check contract schema or context is invalid")
  }
  if (!Number.isInteger(value.integrationId) || value.integrationId <= 0) {
    throw new RepositoryRulesError(REPOSITORY_RULES_ERROR.REQUIRED_STATUS_CHECK_CONTEXT_MISSING, "the exact GitHub Actions App integrationId must be captured from the first real managed pull request check before publication")
  }
  return value
}

export async function loadRequiredCheckContract(repositoryRoot = process.cwd()) {
  const value = JSON.parse(await readFile(path.join(repositoryRoot, ".github", "managed-required-check.json"), "utf8"))
  return parseRequiredCheckContract(value)
}

function flattenRulesets(value) {
  if (!Array.isArray(value)) throw new Error("GitHub rulesets response must be an array")
  return value.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
}

function hasRule(ruleset, type) {
  return Array.isArray(ruleset.rules) && ruleset.rules.some((rule) => rule?.type === type)
}

function hasExactRef(ruleset, ref) {
  const condition = ruleset.conditions?.ref_name
  return Array.isArray(condition?.include) && condition.include.length === 1 && condition.include[0] === ref && Array.isArray(condition.exclude) && condition.exclude.length === 0
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

function hasManagedRequiredCheck(ruleset, requiredCheckIntegrationId) {
  const rule = ruleset.rules?.find((candidate) => candidate?.type === RULESET_CONTRACT.REQUIRED_STATUS_CHECKS)
  if (rule === undefined) return false
  if (rule.parameters?.strict_required_status_checks_policy !== true) return false
  return Array.isArray(rule.parameters.required_status_checks) && rule.parameters.required_status_checks.some((check) => check?.context === RULESET_CONTRACT.REQUIRED_CHECK && check?.integration_id === requiredCheckIntegrationId)
}

function hasCandidateUpdatePolicy(ruleset) {
  const rule = ruleset.rules?.find((candidate) => candidate?.type === RULESET_CONTRACT.UPDATE)
  return rule?.parameters?.update_allows_fetch_and_merge === false
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

export function verifyRepositoryRules(rulesetsInput, { requiredCheckIntegrationId } = {}) {
  const rulesets = flattenRulesets(rulesetsInput)
  const managed = requireRuleset(rulesets, (ruleset) => hasExactRef(ruleset, RULESET_CONTRACT.MANAGED_REF) && hasNoBypassActors(ruleset) && hasRule(ruleset, RULESET_CONTRACT.DELETION) && hasRule(ruleset, RULESET_CONTRACT.NON_FAST_FORWARD) && hasManagedPullRequestPolicy(ruleset), "managed branch ruleset must enforce zero bypass actors, exact ref topology, exact pull request review policy, deletion, and non-fast-forward updates")
  requireRuleset(rulesets, (ruleset) => hasExactRef(ruleset, RULESET_CONTRACT.CANDIDATE_REF) && hasNoBypassActors(ruleset) && hasRule(ruleset, RULESET_CONTRACT.DELETION) && hasRule(ruleset, RULESET_CONTRACT.NON_FAST_FORWARD) && hasCandidateUpdatePolicy(ruleset), "upstream-sync candidate refs must enforce exact ref topology, zero bypass actors, deletion, non-fast-forward updates, and update_allows_fetch_and_merge=false")
  if (!Number.isInteger(requiredCheckIntegrationId) || requiredCheckIntegrationId <= 0) throw new Error("verified required check integrationId is required")
  if (!hasManagedRequiredCheck(managed, requiredCheckIntegrationId)) throw new Error("managed branch ruleset must enforce the exact managed gate context and GitHub Actions App integration_id")
  return { status: "VERIFIED", managedCheck: RULESET_CONTRACT.REQUIRED_CHECK, candidateRef: RULESET_CONTRACT.CANDIDATE_REF }
}

async function main() {
  const args = process.argv.slice(2)
  const repositoryIndex = args.indexOf("--repository")
  const repository = repositoryIndex === -1 ? undefined : args[repositoryIndex + 1]
  if (repository === undefined || repository.trim() === "") throw new Error("usage: verify-repository-rules.mjs --repository <owner/repository>")
  const requiredCheck = await loadRequiredCheckContract()
  const details = await loadRepositoryRulesets(repository)
  console.log(`UPSTREAM_SYNC_REPOSITORY_RULES_VERIFIED ${JSON.stringify(verifyRepositoryRules(details, { requiredCheckIntegrationId: requiredCheck.integrationId }))}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof RepositoryRulesError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "unknown repository rules verification failure")
    process.exitCode = 1
  })
}
