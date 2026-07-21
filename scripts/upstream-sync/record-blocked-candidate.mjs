import { appendFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { classifyUpstream } from "./classify-upstream.mjs"

const SHA_PATTERN = /^[0-9a-f]{40}$/u
export const BLOCKED_REASON = Object.freeze({
  MERGE_CONFLICT: "MERGE_CONFLICT",
  RUNTIME_BUILD_FAILED: "RUNTIME_BUILD_FAILED",
  UPSTREAM_SCOPE_CONFLICT: "UPSTREAM_SCOPE_CONFLICT",
})
const BLOCKED_REASONS = new Set(Object.values(BLOCKED_REASON))

export async function recordBlockedCandidate({ repositoryRoot, artifactRoot, githubOutput, managedSha, sourceSha, lockSha, observationAvailable = false, reviewAcknowledgementPath, blockedReason }) {
  for (const [value, name] of [[managedSha, "managed SHA"], [sourceSha, "source SHA"], [lockSha, "lock SHA"]]) {
    if (!SHA_PATTERN.test(value)) throw new Error(`${name} must be a 40-character lowercase commit SHA`)
  }
  const root = path.resolve(repositoryRoot)
  const artifacts = path.resolve(artifactRoot)
  await mkdir(artifacts, { recursive: true })
  const classification = await classifyUpstream({ repositoryRoot: root, managedSha, sourceSha, lockSha, observationAvailable, reviewAcknowledgementPath, evidenceRoot: root })
  if (blockedReason !== undefined) {
    if (!BLOCKED_REASONS.has(blockedReason)) throw new Error("blocked reason is not a reviewed typed reason")
    if (!classification.blockedReasons.includes(blockedReason)) classification.blockedReasons.push(blockedReason)
    classification.blocked = true
  }
  const metadata = { schemaVersion: 1, status: "BLOCKED", sourceSha, managedSha }
  await Promise.all([
    writeFile(path.join(artifacts, "classification.json"), `${JSON.stringify(classification, null, 2)}\n`, "utf8"),
    writeFile(path.join(artifacts, "candidate-metadata.json"), `${JSON.stringify(metadata)}\n`, "utf8"),
  ])
  await appendFile(githubOutput, "sync_status=blocked\n", "utf8")
  return { classification, metadata }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const values = {
    repositoryRoot: readArgument("--repository-root") ?? process.cwd(),
    artifactRoot: readArgument("--artifact-root"),
    githubOutput: readArgument("--github-output"),
    managedSha: readArgument("--managed-sha"),
    sourceSha: readArgument("--source-sha"),
    lockSha: readArgument("--lock-sha"),
    observationAvailable: args.includes("--observation-available"),
    reviewAcknowledgementPath: readArgument("--review-acknowledgement"),
    blockedReason: readArgument("--blocked-reason"),
  }
  if (Object.entries(values).some(([key, value]) => !["reviewAcknowledgementPath", "observationAvailable", "blockedReason"].includes(key) && value === undefined)) {
    throw new Error("usage: record-blocked-candidate.mjs --artifact-root <path> --github-output <path> --managed-sha <sha> --source-sha <sha> --lock-sha <sha>")
  }
  const result = await recordBlockedCandidate(values)
  console.log(`UPSTREAM_BLOCKED_CANDIDATE_RECORDED ${JSON.stringify(result.metadata)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown blocked candidate recording failure")
    process.exitCode = 1
  })
}
