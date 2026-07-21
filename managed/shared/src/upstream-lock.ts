import { z } from "zod"

export const LOCK_STAGE = {
  BOOTSTRAP: "BOOTSTRAP",
  CORPUS_LOCKED: "CORPUS_LOCKED",
  FINAL: "FINAL",
} as const
export type LockStage = (typeof LOCK_STAGE)[keyof typeof LOCK_STAGE]

const GitCommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u).brand("GitCommitSha")
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u).brand("Sha256")

const baseFields = {
  schemaVersion: z.literal(1),
  upstreamRepository: z.literal("steel-dev/steel-browser"),
  upstreamSha: GitCommitShaSchema,
}

const BootstrapLockSchema = z
  .object({
    ...baseFields,
    lockStage: z.literal(LOCK_STAGE.BOOTSTRAP),
  })
  .strict()

const CorpusLockedLockSchema = z
  .object({
    ...baseFields,
    lockStage: z.literal(LOCK_STAGE.CORPUS_LOCKED),
    protocolCorpusSha256: Sha256Schema,
    sessionIdVerdictSha256: Sha256Schema,
  })
  .strict()

const FinalLockSchema = z
  .object({
    ...baseFields,
    lockStage: z.literal(LOCK_STAGE.FINAL),
    protocolCorpusSha256: Sha256Schema,
    sessionIdVerdictSha256: Sha256Schema,
    browserRuntimeContractSha256: Sha256Schema,
    licenseManifestSha256: Sha256Schema,
    scopeManifestSha256: Sha256Schema,
  })
  .strict()

export const UpstreamLockSchema = z.discriminatedUnion("lockStage", [
  BootstrapLockSchema,
  CorpusLockedLockSchema,
  FinalLockSchema,
])

export type UpstreamLock = Readonly<z.infer<typeof UpstreamLockSchema>>

export function parseUpstreamLock(input: unknown): UpstreamLock {
  return UpstreamLockSchema.parse(input)
}
