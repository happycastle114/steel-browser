import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { verifyCorpusAtRepository } from "./upstream-corpus-files.js"
import { sha256 } from "./upstream-corpus-primitives.js"
import {
  DISCOVERY_MODE,
  EXPECTED_CORPUS_COMMIT,
  EXPECTED_DEPENDENCIES,
  EXPECTED_MANAGED_BASE_COMMIT,
  EXPECTED_OBSERVED_RECEIPT_SHA256,
  EXPECTED_OVERLAY_PLAN_SHA256,
  EXPECTED_PARENT_PLAN_SHA256,
  EXPECTED_PROTOCOL_CORPUS_SHA256,
  EXPECTED_REVIEW_SEQUENCE,
  EXPECTED_SESSION_VERDICT_SHA256,
  EXPECTED_SUPERSESSION,
  EXPECTED_UPSTREAM_SHA,
  OVERLAY_DESCRIPTOR_PATH,
  OVERLAY_ENUMS,
  REVIEW_MERGE_METHOD,
  type DependencyExpectation,
  type SupersessionExpectation,
} from "./managed-overlay-catalog.js"
import { OverlayDescriptorSchema, type ManagedOverlayDescriptor } from "./managed-overlay-schema.js"

export class ManagedOverlayVerificationError extends Error {
  override readonly name = "ManagedOverlayVerificationError"

  constructor(readonly detail: string, options?: ErrorOptions) {
    super(detail, options)
  }
}

function requireEqual(actual: unknown, expected: unknown, detail: string): void {
  if (actual !== expected) {
    throw new ManagedOverlayVerificationError(`${detail}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function requireDeepEqual(actual: unknown, expected: unknown, detail: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new ManagedOverlayVerificationError(`${detail}: expected ${expectedText}, got ${actualText}`)
  }
}

function assertGitAncestor(repositoryRoot: string, ancestor: string, descendant: string, detail: string): void {
  try {
    execFileSync("git", ["-C", repositoryRoot, "merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: "ignore",
    })
  } catch (error) {
    throw new ManagedOverlayVerificationError(detail, { cause: error })
  }
}

function assertEnumVocabulary(descriptor: ManagedOverlayDescriptor): void {
  const expectedNames = Object.keys(OVERLAY_ENUMS)
  const actualNames = Object.keys(descriptor.enums)
  requireDeepEqual(actualNames, expectedNames, "enum vocabulary names drift")
  for (const name of expectedNames) {
    const expectedValues = OVERLAY_ENUMS[name as keyof typeof OVERLAY_ENUMS]
    const actualValues = descriptor.enums[name]
    requireDeepEqual(actualValues, expectedValues, `enum vocabulary drift: ${name}`)
  }
}

function assertSupersession(descriptor: ManagedOverlayDescriptor): void {
  requireEqual(descriptor.supersession.length, EXPECTED_SUPERSESSION.length, "supersession row count drift")
  for (const expected of EXPECTED_SUPERSESSION as readonly SupersessionExpectation[]) {
    const actual = descriptor.supersession.find((entry) => entry.parentItem === expected.parentItem)
    if (actual === undefined) {
      throw new ManagedOverlayVerificationError(`supersession row missing: ${expected.parentItem}`)
    }
    requireEqual(actual.mode, expected.mode, `supersession mode drift: ${expected.parentItem}`)
    requireEqual(actual.authority, expected.authority, `supersession authority drift: ${expected.parentItem}`)
  }
}

function assertDependencies(descriptor: ManagedOverlayDescriptor): void {
  requireEqual(descriptor.dependencies.length, EXPECTED_DEPENDENCIES.length, "dependency row count drift")
  for (const expected of EXPECTED_DEPENDENCIES as readonly DependencyExpectation[]) {
    const actual = descriptor.dependencies.find((entry) => entry.todo === expected.todo)
    if (actual === undefined) {
      throw new ManagedOverlayVerificationError(`dependency row missing: ${expected.todo}`)
    }
    requireDeepEqual(actual.dependsOn, expected.dependsOn, `dependency inputs drift: ${expected.todo}`)
    requireDeepEqual(actual.blocks, expected.blocks, `dependency blocks drift: ${expected.todo}`)
    requireDeepEqual(actual.parallelWith, expected.parallelWith, `dependency parallelism drift: ${expected.todo}`)
  }
}

function assertReviewPolicy(descriptor: ManagedOverlayDescriptor): void {
  requireEqual(descriptor.reviewPolicy.protectedBranch, "managed", "protected branch policy drift")
  requireEqual(descriptor.reviewPolicy.primaryCodeOwner, "happycastle114", "primary code-owner policy drift")
  requireEqual(descriptor.reviewPolicy.secondaryPrAuthor, "soungminsonus-art", "secondary PR-author policy drift")
  requireEqual(descriptor.reviewPolicy.requiredIndependentReview, true, "independent review policy drift")
  requireEqual(descriptor.reviewPolicy.requiredCodeOwnerApproval, true, "code-owner approval policy drift")
  requireEqual(descriptor.reviewPolicy.requiredApprovingReviewCount, 1, "approval count policy drift")
  requireEqual(descriptor.reviewPolicy.allowedMergeMethod, REVIEW_MERGE_METHOD.MERGE, "merge method policy drift")
  requireDeepEqual(descriptor.reviewPolicy.bypassActors, [], "ruleset bypass policy drift")
  requireDeepEqual(descriptor.reviewPolicy.sequence, EXPECTED_REVIEW_SEQUENCE, "review sequence policy drift")
}

function assertGuardrails(descriptor: ManagedOverlayDescriptor): void {
  requireEqual(descriptor.guardrails.maxConcurrentManagedProjects, 1, "managed project cardinality drift")
  requireEqual(descriptor.guardrails.activeWorkerCount, 2, "active worker cardinality drift")
  requireEqual(descriptor.guardrails.discoveryMode, DISCOVERY_MODE.STATIC_CONFIG, "worker discovery mode drift")
  requireEqual(descriptor.guardrails.cutoverMode, "SERIAL_MAINTENANCE", "cutover mode drift")
  requireEqual(descriptor.guardrails.composeDeploymentMode, "RAW_EXPLICIT_PROXY", "compose mode drift")
  requireEqual(descriptor.guardrails.secretIsolationMode, "RAW_COMPOSE_MANAGER_SECRET", "secret isolation mode drift")
  requireEqual(descriptor.guardrails.legacyQuiescenceMode, "MAINTENANCE_NO_ORIGIN", "legacy quiescence mode drift")
  requireDeepEqual(descriptor.guardrails.publicWorkerPorts, [], "worker public-port policy drift")
  requireDeepEqual(descriptor.guardrails.publicDebugPorts, [], "debug public-port policy drift")
}

export function parseManagedOverlayDescriptor(input: unknown): ManagedOverlayDescriptor {
  return OverlayDescriptorSchema.parse(input)
}

export function verifyManagedOverlayDescriptor(descriptor: ManagedOverlayDescriptor): void {
  requireEqual(descriptor.overlay.planSha256, EXPECTED_OVERLAY_PLAN_SHA256, "overlay plan SHA drift")
  requireEqual(descriptor.overlay.parentPlanSha256, EXPECTED_PARENT_PLAN_SHA256, "parent plan SHA drift")
  requireEqual(descriptor.corpus.commit, EXPECTED_CORPUS_COMMIT, "verified corpus commit drift")
  requireEqual(descriptor.corpus.baseCommit, EXPECTED_MANAGED_BASE_COMMIT, "managed base commit drift")
  requireEqual(descriptor.corpus.upstreamSha, EXPECTED_UPSTREAM_SHA, "upstream SHA drift")
  requireEqual(descriptor.corpus.protocolCorpusSha256, EXPECTED_PROTOCOL_CORPUS_SHA256, "protocol corpus digest drift")
  requireEqual(descriptor.corpus.sessionIdVerdictSha256, EXPECTED_SESSION_VERDICT_SHA256, "session verdict digest drift")
  requireEqual(descriptor.corpus.observedReceiptSha256, EXPECTED_OBSERVED_RECEIPT_SHA256, "observed receipt digest drift")
  assertReviewPolicy(descriptor)
  assertGuardrails(descriptor)
  assertEnumVocabulary(descriptor)
  assertSupersession(descriptor)
  assertDependencies(descriptor)
}

export type ManagedOverlayVerification = Readonly<{
  readonly descriptorPath: string
  readonly parentPlanPath: string
  readonly overlayPlanPath: string
  readonly parentPlanSha256: string
  readonly overlayPlanSha256: string
  readonly head: string
  readonly corpusCommit: string
  readonly baseCommit: string
  readonly corpus: Awaited<ReturnType<typeof verifyCorpusAtRepository>>
  readonly supersessionRows: number
  readonly dependencyRows: number
  readonly enumVocabularyCount: number
}>

export type VerifyManagedOverlayOptions = Readonly<{
  readonly repositoryRoot: string
  readonly parentPlanPath: string
  readonly overlayPlanPath: string
  readonly descriptorPath?: string | undefined
  readonly checkCorpus?: boolean | undefined
}>

export async function verifyManagedOverlay(options: VerifyManagedOverlayOptions): Promise<ManagedOverlayVerification> {
  const repositoryRoot = path.resolve(options.repositoryRoot)
  const descriptorPath = path.resolve(repositoryRoot, options.descriptorPath ?? OVERLAY_DESCRIPTOR_PATH)
  const parentPlanPath = path.resolve(options.parentPlanPath)
  const overlayPlanPath = path.resolve(options.overlayPlanPath)
  const descriptorText = await readFile(descriptorPath, "utf8")
  let descriptor: ManagedOverlayDescriptor
  try {
    descriptor = parseManagedOverlayDescriptor(JSON.parse(descriptorText) as unknown)
    verifyManagedOverlayDescriptor(descriptor)
  } catch (error) {
    if (error instanceof ManagedOverlayVerificationError) {
      throw error
    }
    throw new ManagedOverlayVerificationError("overlay descriptor schema/coverage validation failed", { cause: error })
  }

  requireEqual(path.basename(parentPlanPath), descriptor.overlay.parentPlanFile, "parent plan file drift")
  requireEqual(path.basename(overlayPlanPath), descriptor.overlay.planFile, "overlay plan file drift")
  const [parentPlanText, overlayPlanText] = await Promise.all([
    readFile(parentPlanPath, "utf8"),
    readFile(overlayPlanPath, "utf8"),
  ])
  const parentPlanSha256 = sha256(parentPlanText)
  const overlayPlanSha256 = sha256(overlayPlanText)
  requireEqual(parentPlanSha256, EXPECTED_PARENT_PLAN_SHA256, "parent plan content drift")
  requireEqual(overlayPlanSha256, EXPECTED_OVERLAY_PLAN_SHA256, "overlay plan content drift")
  requireEqual(parentPlanSha256, descriptor.overlay.parentPlanSha256, "descriptor parent plan digest mismatch")
  requireEqual(overlayPlanSha256, descriptor.overlay.planSha256, "descriptor overlay plan digest mismatch")

  let head: string
  try {
    head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch (error) {
    throw new ManagedOverlayVerificationError("unable to resolve repository HEAD", { cause: error })
  }
  assertGitAncestor(repositoryRoot, descriptor.corpus.baseCommit, head, "managed base is not an ancestor of HEAD")
  assertGitAncestor(repositoryRoot, descriptor.corpus.commit, head, "verified corpus commit is not an ancestor of HEAD")

  const lockText = await readFile(path.resolve(repositoryRoot, descriptor.corpus.lockPath), "utf8")
  let lockInput: unknown
  try {
    lockInput = JSON.parse(lockText) as unknown
  } catch (error) {
    throw new ManagedOverlayVerificationError("upstream lock is not valid JSON", { cause: error })
  }
  const lock = lockInput as Partial<Record<string, unknown>>
  requireEqual(lock["lockStage"], "CORPUS_LOCKED", "upstream lock stage drift")
  requireEqual(lock["upstreamSha"], descriptor.corpus.upstreamSha, "upstream lock commit drift")
  requireEqual(lock["protocolCorpusSha256"], descriptor.corpus.protocolCorpusSha256, "upstream lock corpus digest mismatch")
  requireEqual(lock["sessionIdVerdictSha256"], descriptor.corpus.sessionIdVerdictSha256, "upstream lock session digest mismatch")

  const corpus = options.checkCorpus === false
    ? ({ upstreamSha: descriptor.corpus.upstreamSha } as Awaited<ReturnType<typeof verifyCorpusAtRepository>>)
    : await verifyCorpusAtRepository(repositoryRoot)
  requireEqual(corpus.upstreamSha, descriptor.corpus.upstreamSha, "verified corpus upstream SHA mismatch")
  requireEqual(corpus.protocolCorpusSha256, descriptor.corpus.protocolCorpusSha256, "verified corpus digest mismatch")
  requireEqual(corpus.sessionIdVerdictSha256, descriptor.corpus.sessionIdVerdictSha256, "verified session digest mismatch")

  return {
    descriptorPath,
    parentPlanPath,
    overlayPlanPath,
    parentPlanSha256,
    overlayPlanSha256,
    head,
    corpusCommit: descriptor.corpus.commit,
    baseCommit: descriptor.corpus.baseCommit,
    corpus,
    supersessionRows: descriptor.supersession.length,
    dependencyRows: descriptor.dependencies.length,
    enumVocabularyCount: Object.keys(descriptor.enums).length,
  }
}
