import { describe, expect, it } from "vitest"

import {
  BASE_REACHABILITY,
  BOOTSTRAP_ACTION,
  BOOTSTRAP_BLOCK_CODE,
  BOOTSTRAP_DECISION,
  FORK_RELATION,
  GH_IDENTITY,
  MAIN_MIRROR,
  MANAGED_BRANCH,
  WORKSPACE_PATH,
  decideBootstrap,
  parseBootstrapFacts,
} from "../src/bootstrap-policy.js"

const compatibleFacts = {
  workspacePath: WORKSPACE_PATH.ABSENT,
  identity: GH_IDENTITY.EXPECTED,
  baseReachability: BASE_REACHABILITY.REACHABLE,
  fork: {
    relation: FORK_RELATION.EXACT_PARENT,
    mainMirror: MAIN_MIRROR.CURRENT,
    managedBranch: MANAGED_BRANCH.ABSENT,
  },
}

describe("fork bootstrap policy", () => {
  it("creates the native fork and managed branch when the fork is absent", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      fork: { relation: FORK_RELATION.ABSENT },
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.READY,
      action: BOOTSTRAP_ACTION.CREATE_FORK_AND_MANAGED,
    })
  })

  it("creates managed for an absent compatible fork branch", () => {
    // Given
    const facts = parseBootstrapFacts(compatibleFacts)

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.READY,
      action: BOOTSTRAP_ACTION.CREATE_MANAGED,
    })
  })

  it("uses an existing managed branch only when its lock and ancestry are compatible", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      fork: { ...compatibleFacts.fork, managedBranch: MANAGED_BRANCH.COMPATIBLE },
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.READY,
      action: BOOTSTRAP_ACTION.USE_MANAGED,
    })
  })

  it("fast-forwards main when upstream advanced from the fork mirror", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      fork: { ...compatibleFacts.fork, mainMirror: MAIN_MIRROR.FAST_FORWARD_REQUIRED },
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.READY,
      action: BOOTSTRAP_ACTION.FAST_FORWARD_MAIN_CREATE_MANAGED,
    })
  })

  it("blocks a non-fast-forward fork mirror", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      fork: { ...compatibleFacts.fork, mainMirror: MAIN_MIRROR.NON_FAST_FORWARD },
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.BLOCKED,
      code: BOOTSTRAP_BLOCK_CODE.NON_FAST_FORWARD_MIRROR,
    })
  })

  it("blocks an unrelated fork", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      fork: { relation: FORK_RELATION.UNRELATED },
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.BLOCKED,
      code: BOOTSTRAP_BLOCK_CODE.UNRELATED_FORK,
    })
  })

  it("blocks a colliding managed branch", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      fork: { ...compatibleFacts.fork, managedBranch: MANAGED_BRANCH.COLLISION },
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.BLOCKED,
      code: BOOTSTRAP_BLOCK_CODE.REMOTE_COLLISION,
    })
  })

  it("blocks a missing pinned base", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      baseReachability: BASE_REACHABILITY.MISSING,
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.BLOCKED,
      code: BOOTSTRAP_BLOCK_CODE.PINNED_BASE_MISSING,
    })
  })

  it("blocks a local workspace collision before repository mutation", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      workspacePath: WORKSPACE_PATH.PRESENT,
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.BLOCKED,
      code: BOOTSTRAP_BLOCK_CODE.LOCAL_PATH_COLLISION,
    })
  })

  it("blocks an unexpected GitHub identity before repository mutation", () => {
    // Given
    const facts = parseBootstrapFacts({
      ...compatibleFacts,
      identity: GH_IDENTITY.OTHER,
    })

    // When
    const decision = decideBootstrap(facts)

    // Then
    expect(decision).toEqual({
      kind: BOOTSTRAP_DECISION.BLOCKED,
      code: BOOTSTRAP_BLOCK_CODE.IDENTITY_MISMATCH,
    })
  })
})
