import assert from "node:assert/strict"
import test from "node:test"

import { RULESET_CONTRACT, verifyRepositoryRules } from "./verify-repository-rules.mjs"

function ruleset(ref, rules) {
  return { enforcement: RULESET_CONTRACT.ACTIVE, target: RULESET_CONTRACT.BRANCH, conditions: { ref_name: { include: [ref] } }, rules }
}

const requiredCheckRule = { type: RULESET_CONTRACT.REQUIRED_STATUS_CHECKS, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: RULESET_CONTRACT.REQUIRED_CHECK }] } }
const baselineRules = [{ type: RULESET_CONTRACT.DELETION }, { type: RULESET_CONTRACT.NON_FAST_FORWARD }, { type: RULESET_CONTRACT.PULL_REQUEST }]

test("repository rules verifier requires managed checks and immutable candidate refs", () => {
  assert.deepEqual(verifyRepositoryRules([
    ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, requiredCheckRule]),
    ruleset(RULESET_CONTRACT.CANDIDATE_REF, [...baselineRules.slice(0, 2), { type: RULESET_CONTRACT.UPDATE }]),
  ]), { status: "VERIFIED", managedCheck: RULESET_CONTRACT.REQUIRED_CHECK, candidateRef: RULESET_CONTRACT.CANDIDATE_REF })
})

test("repository rules verifier rejects an unprotected candidate wildcard", () => {
  assert.throws(() => verifyRepositoryRules([ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, requiredCheckRule])]), /candidate refs must be protected/)
})

test("repository rules verifier rejects a managed ruleset without the required gate context", () => {
  assert.throws(() => verifyRepositoryRules([
    ruleset(RULESET_CONTRACT.MANAGED_REF, [...baselineRules, { ...requiredCheckRule, parameters: { ...requiredCheckRule.parameters, required_status_checks: [{ context: "other" }] } }]),
    ruleset(RULESET_CONTRACT.CANDIDATE_REF, [...baselineRules.slice(0, 2), { type: RULESET_CONTRACT.UPDATE }]),
  ]), /managed branch ruleset must enforce/)
})
