import assert from "node:assert/strict"
import test from "node:test"

import { RULESET_CONTRACT, loadRepositoryRulesets, parseRequiredCheckContract, verifyRepositoryRules } from "./verify-repository-rules.mjs"

const GITHUB_ACTIONS_INTEGRATION_ID = 15368

function ruleset(ref, rules) {
  return { enforcement: RULESET_CONTRACT.ACTIVE, target: RULESET_CONTRACT.BRANCH, bypass_actors: [], conditions: { ref_name: { include: [ref], exclude: [] } }, rules }
}

const requiredCheckRule = { type: RULESET_CONTRACT.REQUIRED_STATUS_CHECKS, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: RULESET_CONTRACT.REQUIRED_CHECK, integration_id: GITHUB_ACTIONS_INTEGRATION_ID }] } }
const pullRequestRule = { type: RULESET_CONTRACT.PULL_REQUEST, parameters: { allowed_merge_methods: ["merge"], dismiss_stale_reviews_on_push: true, require_code_owner_review: true, require_last_push_approval: false, required_approving_review_count: 1, required_review_thread_resolution: true } }
const baselineRules = [{ type: RULESET_CONTRACT.DELETION }, { type: RULESET_CONTRACT.NON_FAST_FORWARD }, pullRequestRule]

test("repository rules verifier requires managed checks and immutable candidate refs", () => {
  assert.deepEqual(verifyRepositoryRules([
    ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, requiredCheckRule]),
    ruleset(RULESET_CONTRACT.CANDIDATE_REF, [...baselineRules.slice(0, 2), { type: RULESET_CONTRACT.UPDATE, parameters: { update_allows_fetch_and_merge: false } }]),
  ], { requiredCheckIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID }), { status: "VERIFIED", managedCheck: RULESET_CONTRACT.REQUIRED_CHECK, candidateRef: RULESET_CONTRACT.CANDIDATE_REF })
})

test("repository rules verifier rejects an unprotected candidate wildcard", () => {
  assert.throws(() => verifyRepositoryRules([ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, requiredCheckRule])], { requiredCheckIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID }), /candidate refs must enforce/)
})

test("repository rules verifier rejects a managed ruleset without the required gate context", () => {
  assert.throws(() => verifyRepositoryRules([
    ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, { ...requiredCheckRule, parameters: { ...requiredCheckRule.parameters, required_status_checks: [{ context: "other" }] } }]),
    ruleset(RULESET_CONTRACT.CANDIDATE_REF, [...baselineRules.slice(0, 2), { type: RULESET_CONTRACT.UPDATE, parameters: { update_allows_fetch_and_merge: false } }]),
  ], { requiredCheckIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID }), /exact managed gate context/)
})

for (const [label, mutate] of [
  ["bypass actors", (rules) => ({ ...rules, bypass_actors: [{ actor_id: 7 }] })],
  ["zero approvals", (rules) => ({ ...rules, rules: rules.rules.map((rule) => rule.type === RULESET_CONTRACT.PULL_REQUEST ? { ...rule, parameters: { ...rule.parameters, required_approving_review_count: 0 } } : rule) })],
  ["disabled code owner review", (rules) => ({ ...rules, rules: rules.rules.map((rule) => rule.type === RULESET_CONTRACT.PULL_REQUEST ? { ...rule, parameters: { ...rule.parameters, require_code_owner_review: false } } : rule) })],
  ["disabled thread resolution", (rules) => ({ ...rules, rules: rules.rules.map((rule) => rule.type === RULESET_CONTRACT.PULL_REQUEST ? { ...rule, parameters: { ...rule.parameters, required_review_thread_resolution: false } } : rule) })],
  ["disabled stale dismissal", (rules) => ({ ...rules, rules: rules.rules.map((rule) => rule.type === RULESET_CONTRACT.PULL_REQUEST ? { ...rule, parameters: { ...rule.parameters, dismiss_stale_reviews_on_push: false } } : rule) })],
  ["merge method drift", (rules) => ({ ...rules, rules: rules.rules.map((rule) => rule.type === RULESET_CONTRACT.PULL_REQUEST ? { ...rule, parameters: { ...rule.parameters, allowed_merge_methods: ["squash"] } } : rule) })],
]) {
  test(`repository rules verifier rejects ${label} drift`, () => {
    const managed = ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, requiredCheckRule])
    const candidate = ruleset(RULESET_CONTRACT.CANDIDATE_REF, [...baselineRules.slice(0, 2), { type: RULESET_CONTRACT.UPDATE, parameters: { update_allows_fetch_and_merge: false } }])
    assert.throws(() => verifyRepositoryRules([mutate(managed), candidate], { requiredCheckIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID }), /managed branch ruleset must enforce/)
  })
}

test("repository rules verifier blocks with a typed reason until the real check integration id is observed", () => {
  assert.throws(() => parseRequiredCheckContract({ schemaVersion: 1, context: RULESET_CONTRACT.REQUIRED_CHECK, integrationId: null }), (error) => error?.code === "REQUIRED_STATUS_CHECK_CONTEXT_MISSING")
  assert.deepEqual(parseRequiredCheckContract({ schemaVersion: 1, context: RULESET_CONTRACT.REQUIRED_CHECK, integrationId: GITHUB_ACTIONS_INTEGRATION_ID }), { schemaVersion: 1, context: RULESET_CONTRACT.REQUIRED_CHECK, integrationId: GITHUB_ACTIONS_INTEGRATION_ID })
})

test("repository rules verifier rejects context-only, wrong-app, excluded, and fail-open update policies", () => {
  const candidate = ruleset(RULESET_CONTRACT.CANDIDATE_REF, [...baselineRules.slice(0, 2), { type: RULESET_CONTRACT.UPDATE, parameters: { update_allows_fetch_and_merge: false } }])
  for (const check of [
    { context: RULESET_CONTRACT.REQUIRED_CHECK },
    { context: RULESET_CONTRACT.REQUIRED_CHECK, integration_id: GITHUB_ACTIONS_INTEGRATION_ID + 1 },
  ]) {
    const managed = ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, { ...requiredCheckRule, parameters: { ...requiredCheckRule.parameters, required_status_checks: [check] } }])
    assert.throws(() => verifyRepositoryRules([managed, candidate], { requiredCheckIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID }), /exact managed gate context/)
  }
  const excluded = { ...candidate, conditions: { ref_name: { include: [RULESET_CONTRACT.CANDIDATE_REF], exclude: [RULESET_CONTRACT.CANDIDATE_REF] } } }
  assert.throws(() => verifyRepositoryRules([ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, requiredCheckRule]), excluded], { requiredCheckIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID }), /exact ref topology/)
  const failOpenUpdate = { ...candidate, rules: candidate.rules.map((rule) => rule.type === RULESET_CONTRACT.UPDATE ? { ...rule, parameters: { update_allows_fetch_and_merge: true } } : rule) }
  assert.throws(() => verifyRepositoryRules([ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, requiredCheckRule]), failOpenUpdate], { requiredCheckIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID }), /update_allows_fetch_and_merge=false/)
})

test("repository rules verifier resolves list entries through detail endpoints", async () => {
  const calls = []
  const execute = async (_command, args) => {
    calls.push(args)
    if (args[1] === "repos/owner/repo/rulesets") return { stdout: JSON.stringify([[{ id: 42 }]]) }
    return { stdout: JSON.stringify({ id: 42, name: "detail", target: "branch", enforcement: "active", conditions: {}, rules: [] }) }
  }
  const result = await loadRepositoryRulesets("owner/repo", execute)
  assert.deepEqual(result, [{ id: 42, name: "detail", target: "branch", enforcement: "active", conditions: {}, rules: [] }])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].slice(0, 2), ["api", "repos/owner/repo/rulesets/42"])
})
