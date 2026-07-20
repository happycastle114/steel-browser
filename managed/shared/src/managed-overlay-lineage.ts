import { execFileSync } from "node:child_process"

import {
  EXPECTED_CORPUS_COMMIT,
  EXPECTED_MANAGED_BASE_COMMIT,
  OVERLAY_ERROR_CODE,
} from "./managed-overlay-catalog.js"
import { overlayFailure } from "./managed-overlay-errors.js"

export type OverlayLineageFacts = Readonly<{
  readonly head: string
  readonly parentCommits: readonly string[]
  readonly worktreeClean: boolean
  readonly indexClean: boolean
  readonly baseIsAncestor: boolean
  readonly overlayDiffPresent: boolean
}>

export type OverlayLineageExpectation = Readonly<{
  readonly corpusCommit?: string
}>

function runGit(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" }).trim()
}

function predicateGit(repositoryRoot: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", ["-C", repositoryRoot, ...args], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function readOverlayLineage(repositoryRoot: string, corpusCommit = EXPECTED_CORPUS_COMMIT, baseCommit = EXPECTED_MANAGED_BASE_COMMIT): OverlayLineageFacts {
  const status = runGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"])
  const head = runGit(repositoryRoot, ["rev-parse", "HEAD"])
  const parentLine = runGit(repositoryRoot, ["rev-list", "--parents", "-n", "1", "HEAD"])
  const [, ...parentCommits] = parentLine.split(/\s+/u)
  return {
    head,
    parentCommits,
    worktreeClean:
      predicateGit(repositoryRoot, ["diff", "--quiet"]) &&
      !status.split("\n").some((line) => line.startsWith("??")),
    indexClean: predicateGit(repositoryRoot, ["diff", "--cached", "--quiet"]),
    baseIsAncestor: predicateGit(repositoryRoot, ["merge-base", "--is-ancestor", baseCommit, head]),
    overlayDiffPresent: !predicateGit(repositoryRoot, ["diff", "--quiet", corpusCommit, head]),
  }
}

export function assertExactOverlayLineage(
  facts: OverlayLineageFacts,
  expectation: OverlayLineageExpectation = {},
): void {
  const corpusCommit = expectation.corpusCommit ?? EXPECTED_CORPUS_COMMIT
  switch (true) {
    case !facts.worktreeClean:
      return overlayFailure(OVERLAY_ERROR_CODE.DIRTY_WORKTREE, "worktree has unstaged or untracked changes")
    case !facts.indexClean:
      return overlayFailure(OVERLAY_ERROR_CODE.DIRTY_INDEX, "index has staged changes")
    case facts.parentCommits.length !== 1:
      return overlayFailure(OVERLAY_ERROR_CODE.INVALID_PARENT_COUNT, "HEAD must have exactly one parent")
    case facts.parentCommits[0] !== corpusCommit:
      return overlayFailure(OVERLAY_ERROR_CODE.INVALID_DIRECT_PARENT, "HEAD parent is not the verified corpus commit")
    case !facts.overlayDiffPresent:
      return overlayFailure(OVERLAY_ERROR_CODE.UNCOMMITTED_OVERLAY, "HEAD tree has no overlay diff over the corpus commit")
    case !facts.baseIsAncestor:
      return overlayFailure(OVERLAY_ERROR_CODE.BASE_ANCESTRY_DRIFT, "frozen managed base is not an ancestor of HEAD")
    default:
      return
  }
}
