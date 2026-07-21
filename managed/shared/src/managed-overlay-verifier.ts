import { readFile } from "node:fs/promises"
import path from "node:path"

import { parseUpstreamLock, LOCK_STAGE } from "./upstream-lock.js"
import { verifyCorpusAtRepository } from "./upstream-corpus-files.js"
import { sha256 } from "./upstream-corpus-primitives.js"
import {
  EXPECTED_OVERLAY_PLAN_SHA256,
  EXPECTED_PARENT_PLAN_SHA256,
  OVERLAY_DESCRIPTOR_PATH,
  OVERLAY_ERROR_CODE,
} from "./managed-overlay-catalog.js"
import { ManagedOverlayVerificationError, overlayFailure } from "./managed-overlay-errors.js"
import { readOverlayLineage, assertExactOverlayLineage } from "./managed-overlay-lineage.js"
import {
  parseManagedOverlayDescriptor,
  verifyManagedOverlayDescriptor,
} from "./managed-overlay-descriptor-verifier.js"
import type { ManagedOverlayDescriptor } from "./managed-overlay-schema.js"

export { ManagedOverlayVerificationError }

export { parseManagedOverlayDescriptor, verifyManagedOverlayDescriptor }

function requireEqual(actual: unknown, expected: unknown, detail: string): void {
  if (actual !== expected) {
    overlayFailure(
      OVERLAY_ERROR_CODE.VERIFICATION_MISMATCH,
      `${detail}: expected ${String(expected)}, got ${String(actual)}`,
    )
  }
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
  assertExactOverlayLineage(lineage, { corpusCommit: descriptor.corpus.commit })

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
