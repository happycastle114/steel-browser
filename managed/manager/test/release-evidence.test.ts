import { createHash } from "node:crypto"
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { z } from "zod"
import { afterEach, describe, expect, it } from "vitest"
import {
  loadVerifiedReleaseEvidenceFile,
  ReleaseEvidenceError,
  ReleaseEvidenceFailure,
  ReleaseEvidenceMode,
} from "../src/release/release-evidence.js"

const EvidenceSchema = z
  .object({ schemaVersion: z.literal(1), workerDigest: z.string().min(1) })
  .strict()
  .readonly()

describe("release evidence file", () => {
  let directory: string | undefined

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { force: true, recursive: true })
  })

  it("binds the exact validated config bytes to their SHA-256", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "steel-release-evidence-"))
    const evidencePath = path.join(directory, "release-evidence.json")
    const bytes = Buffer.from('{"schemaVersion":1,"workerDigest":"sha256:worker"}\n')
    await writeFile(evidencePath, bytes, { mode: 0o400 })
    await chmod(evidencePath, 0o400)

    const verified = await loadVerifiedReleaseEvidenceFile({
      expectedGid: process.getgid?.() ?? 0,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      expectedUid: process.getuid?.() ?? 0,
      path: evidencePath,
      schema: EvidenceSchema,
    })

    expect(verified).toEqual({
      evidence: { schemaVersion: 1, workerDigest: "sha256:worker" },
      mode: ReleaseEvidenceMode.CONFIG_FILE,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
  })

  it("rejects weakened metadata, symlinks, malformed JSON, and schema drift", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "steel-release-evidence-reject-"))
    const evidencePath = path.join(directory, "release-evidence.json")
    const linkPath = path.join(directory, "release-evidence-link.json")
    await writeFile(evidencePath, "{}", { mode: 0o600 })
    await symlink(evidencePath, linkPath)
    const base = {
      expectedGid: process.getgid?.() ?? 0,
      expectedSha256: createHash("sha256").update("{}").digest("hex"),
      expectedUid: process.getuid?.() ?? 0,
      schema: EvidenceSchema,
    }

    await expect(loadVerifiedReleaseEvidenceFile({ ...base, path: evidencePath })).rejects.toMatchObject({
      code: ReleaseEvidenceFailure.METADATA,
    } satisfies Partial<ReleaseEvidenceError>)
    await expect(loadVerifiedReleaseEvidenceFile({ ...base, path: linkPath })).rejects.toMatchObject({
      code: ReleaseEvidenceFailure.FILE,
    } satisfies Partial<ReleaseEvidenceError>)
    await writeFile(evidencePath, "{", { mode: 0o400 })
    await chmod(evidencePath, 0o400)
    await expect(loadVerifiedReleaseEvidenceFile({ ...base, path: evidencePath })).rejects.toMatchObject({
      code: ReleaseEvidenceFailure.HASH,
    } satisfies Partial<ReleaseEvidenceError>)
    await expect(loadVerifiedReleaseEvidenceFile({
      ...base,
      expectedSha256: createHash("sha256").update("{").digest("hex"),
      path: evidencePath,
    })).rejects.toMatchObject({
      code: ReleaseEvidenceFailure.CONTENT,
    } satisfies Partial<ReleaseEvidenceError>)
    await chmod(evidencePath, 0o600)
    await writeFile(evidencePath, "{}")
    await chmod(evidencePath, 0o400)
    await expect(loadVerifiedReleaseEvidenceFile({ ...base, path: evidencePath })).rejects.toMatchObject({
      code: ReleaseEvidenceFailure.SCHEMA,
    } satisfies Partial<ReleaseEvidenceError>)
  })
})
