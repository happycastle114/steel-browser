import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { verifyCandidateCommit } from "./verify-candidate-commit.mjs"
import { verifyCaptureBinding } from "./verify-capture-binding.mjs"

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[0-9a-f]{40}$/u

async function git(repositoryRoot, args, encoding = "utf8") {
  return (await execFileAsync("git", args, { cwd: repositoryRoot, encoding, maxBuffer: 16 * 1024 * 1024 })).stdout
}

export async function verifyExistingCandidate({ repositoryRoot, commitSha, managedSha, sourceSha, bindingOutput, classificationOutput, authoritativeVerifier }) {
  for (const [value, name] of [[commitSha, "candidate SHA"], [managedSha, "managed SHA"], [sourceSha, "source SHA"]]) {
    if (!SHA_PATTERN.test(value)) throw new Error(`${name} is invalid`)
  }
  const mergeCommitSha = (await git(repositoryRoot, ["rev-parse", `${commitSha}^`])).trim()
  const treeSha = (await git(repositoryRoot, ["rev-parse", `${commitSha}^{tree}`])).trim()
  const corpusRoot = `managed/tests/upstream/${sourceSha}`
  const [bindingBytes, classificationBytes] = await Promise.all([
    git(repositoryRoot, ["show", `${commitSha}:${corpusRoot}/observation-provenance.json`], "buffer"),
    git(repositoryRoot, ["show", `${commitSha}:${corpusRoot}/classification.json`], "buffer"),
  ])
  await Promise.all([writeFile(bindingOutput, bindingBytes), writeFile(classificationOutput, classificationBytes)])
  await verifyCandidateCommit({ repositoryRoot, commitSha, mergeCommitSha, managedSha, sourceSha, treeSha, allowedUntrackedPaths: ["sync-artifact/"], authoritativeVerifier })
  await verifyCaptureBinding({ repositoryRoot, commitSha, sourceSha, bindingPath: bindingOutput })
  return { status: "REUSED_VERIFIED_IMMUTABLE_CANDIDATE", commitSha, mergeCommitSha, treeSha, classificationOutput }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const values = {
    repositoryRoot: readArgument("--repository-root") ?? process.cwd(),
    commitSha: readArgument("--commit-sha"),
    managedSha: readArgument("--managed-sha"),
    sourceSha: readArgument("--source-sha"),
    bindingOutput: readArgument("--binding-output"),
    classificationOutput: readArgument("--classification-output"),
  }
  if (Object.values(values).some((value) => value === undefined)) throw new Error("usage: verify-existing-candidate.mjs --commit-sha <sha> --managed-sha <sha> --source-sha <sha> --binding-output <path> --classification-output <path>")
  console.log(`UPSTREAM_EXISTING_CANDIDATE_VERIFIED ${JSON.stringify(await verifyExistingCandidate(values))}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown existing candidate verification failure")
    process.exitCode = 1
  })
}
