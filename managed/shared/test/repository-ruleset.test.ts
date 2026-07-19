import { describe, expect, it } from "vitest"

import mainMirrorRulesetInput from "../../../.github/rulesets/main-mirror.json"
import managedRulesetInput from "../../../.github/rulesets/managed.json"
import {
  BRANCH_REF,
  REPOSITORY_RULE,
  RULESET_ENFORCEMENT,
  parseRepositoryRuleset,
} from "../src/repository-ruleset.js"

describe("repository ruleset manifests", () => {
  it("protects main mirror history while allowing fast-forward sync", () => {
    // Given
    const input = mainMirrorRulesetInput

    // When
    const ruleset = parseRepositoryRuleset(input)

    // Then
    expect(ruleset).toMatchObject({
      enforcement: RULESET_ENFORCEMENT.ACTIVE,
      conditions: { ref_name: { include: [BRANCH_REF.MAIN] } },
      rules: [{ type: REPOSITORY_RULE.DELETION }, { type: REPOSITORY_RULE.NON_FAST_FORWARD }],
    })
  })

  it("requires reviewed pull requests for managed without bypass actors", () => {
    // Given
    const input = managedRulesetInput

    // When
    const ruleset = parseRepositoryRuleset(input)

    // Then
    expect(ruleset).toMatchObject({
      enforcement: RULESET_ENFORCEMENT.ACTIVE,
      bypass_actors: [],
      conditions: { ref_name: { include: [BRANCH_REF.MANAGED] } },
      rules: [
        { type: REPOSITORY_RULE.DELETION },
        { type: REPOSITORY_RULE.NON_FAST_FORWARD },
        {
          type: REPOSITORY_RULE.PULL_REQUEST,
          parameters: {
            require_code_owner_review: true,
            required_approving_review_count: 1,
          },
        },
      ],
    })
  })
})
