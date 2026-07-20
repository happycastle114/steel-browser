import { readFile } from "node:fs/promises"
import path from "node:path"

import { parseUpstreamLock, LOCK_STAGE } from "./upstream-lock.js"
import { verifyCorpusAtRepository } from "./upstream-corpus-files.js"
import { sha256 } from "./upstream-corpus-primitives.js"
import {
  COOLIFY_COMPOSE_DEPLOYMENT_MODE,
  COOLIFY_CUTOVER_MODE,
  COOLIFY_SECRET_ISOLATION_MODE,
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
  LEGACY_QUIESCENCE_MODE,
  OVERLAY_DESCRIPTOR_PATH,
  OVERLAY_ENUMS,
  OVERLAY_ERROR_CODE,
  REVIEW_ACTOR,
} from "./managed-overlay-catalog.js"
import { ManagedOverlayVerificationError, overlayFailure } from "./managed-overlay-errors.js"
import { readOverlayLineage, assertExactOverlayLineage } from "./managed-overlay-lineage.js"
import { OverlayDescriptorSchema, type ManagedOverlayDescriptor } from "./managed-overlay-schema.js"

export { ManagedOverlayVerificationError }

function requireEqual(actual: unknown, expected: unknown, detail: string): void {
  if (actual !== expected) {
    overlayFailure(OVERLAY_ERROR_CODE.VERIFICATION_MISMATCH, `${detail}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function requireDeepEqual(actual: unknown, expected: unknown, detail: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    overlayFailure(OVERLAY_ERROR_CODE.VERIFICATION_MISMATCH, `${detail}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertEnumVocabulary(descriptor: ManagedOverlayDescriptor): void {
  const expectedNames = Object.keys(OVERLAY_ENUMS)
  requireDeepEqual(Object.keys(descriptor.enums), expectedNames, "enum vocabulary names drift")
  for (const [name, expectedValues] of Object.entries(OVERLAY_ENUMS)) {
    requireDeepEqual(descriptor.enums[name], expectedValues, `enum vocabulary drift: ${name}`)
  }
}

function assertSupersession(descriptor: ManagedOverlayDescriptor): void {
  if (descriptor.supersession.length !== EXPECTED_SUPERSESSION.length) {
    overlayFailure(OVERLAY_ERROR_CODE.SUPERSESSION_COVERAGE, `expected ${EXPECTED_SUPERSESSION.length} rows, got ${descriptor.supersession.length}`)
  }
  for (const expected of EXPECTED_SUPERSESSION) {
    const actual = descriptor.supersession.find((entry) => entry.parentItem === expected.parentItem)
    if (actual === undefined) {
      overlayFailure(OVERLAY_ERROR_CODE.SUPERSESSION_COVERAGE, `missing row: ${expected.parentItem}`)
    }
    requireEqual(actual.mode, expected.mode, `supersession mode drift: ${expected.parentItem}`)
    requireEqual(actual.modeDomain, expected.modeDomain, `supersession domain drift: ${expected.parentItem}`)
    requireDeepEqual(actual.secondaryModes, expected.secondaryModes, `supersession secondary mode drift: ${expected.parentItem}`)
    requireEqual(actual.authority, expected.authority, `supersession authority drift: ${expected.parentItem}`)
  }
}

function assertDependencies(descriptor: ManagedOverlayDescriptor): void {
  if (descriptor.dependencies.length !== EXPECTED_DEPENDENCIES.length) {
    overlayFailure(OVERLAY_ERROR_CODE.DEPENDENCY_COVERAGE, `expected ${EXPECTED_DEPENDENCIES.length} rows, got ${descriptor.dependencies.length}`)
  }
  for (const expected of EXPECTED_DEPENDENCIES) {
    const actual = descriptor.dependencies.find((entry) => entry.todo === expected.todo)
    if (actual === undefined) {
      overlayFailure(OVERLAY_ERROR_CODE.DEPENDENCY_COVERAGE, `missing row: ${expected.todo}`)
    }
    requireDeepEqual(actual.dependsOn, expected.dependsOn, `dependency inputs drift: ${expected.todo}`)
    requireDeepEqual(actual.blocks, expected.blocks, `dependency blocks drift: ${expected.todo}`)
    requireDeepEqual(actual.parallelWith, expected.parallelWith, `dependency parallelism drift: ${expected.todo}`)
  }
}

function assertReviewPolicy(descriptor: ManagedOverlayDescriptor): void {
  if (descriptor.reviewPolicy.secondaryPrAuthor !== REVIEW_ACTOR.SECONDARY_PR_AUTHOR) {
    overlayFailure(OVERLAY_ERROR_CODE.REVIEW_SECONDARY_AUTHOR, "secondary PR-author policy drift")
  }
  if (descriptor.reviewPolicy.requiredCodeOwnerApproval !== true) {
    overlayFailure(OVERLAY_ERROR_CODE.REVIEW_CODEOWNER_APPROVAL, "code-owner approval policy drift")
  }
  requireDeepEqual(descriptor.reviewPolicy.sequence, EXPECTED_REVIEW_SEQUENCE, "review sequence policy drift")
}

function assertGuardrails(descriptor: ManagedOverlayDescriptor): void {
  requireEqual(descriptor.guardrails.maxConcurrentManagedProjects, 1, "managed project cardinality drift")
  requireEqual(descriptor.guardrails.activeWorkerCount, 2, "active worker cardinality drift")
  requireEqual(descriptor.guardrails.discoveryMode, DISCOVERY_MODE.STATIC_CONFIG, "worker discovery mode drift")
  requireEqual(descriptor.guardrails.cutoverMode, COOLIFY_CUTOVER_MODE.SERIAL_MAINTENANCE, "cutover mode drift")
  requireEqual(descriptor.guardrails.composeDeploymentMode, COOLIFY_COMPOSE_DEPLOYMENT_MODE.RAW_EXPLICIT_PROXY, "compose mode drift")
  requireEqual(descriptor.guardrails.secretIsolationMode, COOLIFY_SECRET_ISOLATION_MODE.RAW_COMPOSE_MANAGER_SECRET, "secret isolation mode drift")
  requireEqual(descriptor.guardrails.legacyQuiescenceMode, LEGACY_QUIESCENCE_MODE.MAINTENANCE_NO_ORIGIN, "legacy quiescence mode drift")
  requireDeepEqual(descriptor.guardrails.publicWorkerPorts, [], "worker public-port policy drift")
  requireDeepEqual(descriptor.guardrails.publicDebugPorts, [], "debug public-port policy drift")
}

export function parseManagedOverlayDescriptor(input: unknown): ManagedOverlayDescriptor {
  return OverlayDescriptorSchema.parse(input)
}

export function verifyManagedOverlayDescriptor(descriptor: ManagedOverlayDescriptor): void {
  if (descriptor.overlay.planSha256 !== EXPECTED_OVERLAY_PLAN_SHA256) {
    overlayFailure(OVERLAY_ERROR_CODE.OVERLAY_PLAN_SHA_DRIFT, "descriptor overlay plan SHA is not approved")
  }
  if (descriptor.overlay.parentPlanSha256 !== EXPECTED_PARENT_PLAN_SHA256) {
    overlayFailure(OVERLAY_ERROR_CODE.PARENT_PLAN_SHA_DRIFT, "descriptor parent plan SHA is not frozen")
  }
  if (descriptor.corpus.commit !== EXPECTED_CORPUS_COMMIT) {
    overlayFailure(OVERLAY_ERROR_CODE.CORPUS_COMMIT_DRIFT, "descriptor corpus commit is not the verified commit")
  }
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
}>

export async function verifyManagedOverlay(options: VerifyManagedOverlayOptions): Promise<ManagedOverlayVerification> {
  const repositoryRoot = path.resolve(options.repositoryRoot)
  const descriptorPath = path.resolve(repositoryRoot, options.descriptorPath ?? OVERLAY_DESCRIPTOR_PATH)
  const parentPlanPath = path.resolve(options.parentPlanPath)
  const overlayPlanPath = path.resolve(options.overlayPlanPath)
  let descriptor: ManagedOverlayDescriptor
  try {
    descriptor = parseManagedOverlayDescriptor(JSON.parse(await readFile(descriptorPath, "utf8")))
    verifyManagedOverlayDescriptor(descriptor)
  } catch (error) {
    if (error instanceof ManagedOverlayVerificationError) throw error
    overlayFailure(OVERLAY_ERROR_CODE.DESCRIPTOR_SCHEMA, error instanceof Error ? error.message : "descriptor schema failed")
  }
  if (path.basename(parentPlanPath) !== descriptor.overlay.parentPlanFile) {
    overlayFailure(OVERLAY_ERROR_CODE.PARENT_PLAN_SHA_DRIFT, "parent plan filename is not bound")
  }
  if (path.basename(overlayPlanPath) !== descriptor.overlay.planFile) {
    overlayFailure(OVERLAY_ERROR_CODE.OVERLAY_PLAN_SHA_DRIFT, "overlay plan filename is not bound")
  }
  const [parentText, overlayText] = await Promise.all([readFile(parentPlanPath, "utf8"), readFile(overlayPlanPath, "utf8")])
  const parentPlanSha256 = sha256(parentText)
  const overlayPlanSha256 = sha256(overlayText)
  if (parentPlanSha256 !== EXPECTED_PARENT_PLAN_SHA256) overlayFailure(OVERLAY_ERROR_CODE.PARENT_PLAN_SHA_DRIFT, "parent plan content drift")
  if (overlayPlanSha256 !== EXPECTED_OVERLAY_PLAN_SHA256) overlayFailure(OVERLAY_ERROR_CODE.OVERLAY_PLAN_SHA_DRIFT, "overlay plan content drift")
  const lineage = readOverlayLineage(repositoryRoot, descriptor.corpus.commit, descriptor.corpus.baseCommit)
  assertExactOverlayLineage(lineage, { corpusCommit: descriptor.corpus.commit, baseCommit: descriptor.corpus.baseCommit })

  let lock: ReturnType<typeof parseUpstreamLock>
  try {
    lock = parseUpstreamLock(JSON.parse(await readFile(path.resolve(repositoryRoot, descriptor.corpus.lockPath), "utf8")))
  } catch (error) {
    overlayFailure(OVERLAY_ERROR_CODE.LOCK_DIGEST_DRIFT, error instanceof Error ? error.message : "upstream lock parse failed")
  }
  switch (lock.lockStage) {
    case LOCK_STAGE.CORPUS_LOCKED:
      break
    case LOCK_STAGE.BOOTSTRAP:
    case LOCK_STAGE.FINAL:
      overlayFailure(OVERLAY_ERROR_CODE.LOCK_STAGE_DRIFT, "upstream lock is not corpus-locked")
  }
  requireEqual(lock.upstreamSha, descriptor.corpus.upstreamSha, "upstream lock commit drift")
  requireEqual(lock.protocolCorpusSha256, descriptor.corpus.protocolCorpusSha256, "upstream lock corpus digest mismatch")
  requireEqual(lock.sessionIdVerdictSha256, descriptor.corpus.sessionIdVerdictSha256, "upstream lock session digest mismatch")
  const corpus = await verifyCorpusAtRepository(repositoryRoot)
  requireEqual(corpus.upstreamSha, descriptor.corpus.upstreamSha, "verified corpus upstream SHA mismatch")
  requireEqual(corpus.protocolCorpusSha256, descriptor.corpus.protocolCorpusSha256, "verified corpus digest mismatch")
  requireEqual(corpus.sessionIdVerdictSha256, descriptor.corpus.sessionIdVerdictSha256, "verified session digest mismatch")
  return {
    descriptorPath,
    parentPlanPath,
    overlayPlanPath,
    parentPlanSha256,
    overlayPlanSha256,
    head: lineage.head,
    corpusCommit: descriptor.corpus.commit,
    baseCommit: descriptor.corpus.baseCommit,
    corpus,
    supersessionRows: descriptor.supersession.length,
    dependencyRows: descriptor.dependencies.length,
    enumVocabularyCount: Object.keys(descriptor.enums).length,
  }
}
