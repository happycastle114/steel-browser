import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[0-9a-f]{40}$/u

export const MERGE_STATUS = Object.freeze({ MERGED: "MERGED", BLOCKED: "BLOCKED" })
export const MERGE_BLOCK_REASON = Object.freeze({ MERGE_CONFLICT: "MERGE_CONFLICT" })

async function git(repositoryRoot, args) {
  return (await execFileAsync("git", args, { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 })).stdout.trim()
}

export async function mergeCandidate({ repositoryRoot, managedSha, sourceSha }) {
  for (const [value, name] of [[managedSha, "managed SHA"], [sourceSha, "source SHA"]]) {
    if (!SHA_PATTERN.test(value)) throw new Error(`${name} is invalid`)
  }
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"])
  if (head !== managedSha) throw new Error("candidate merge did not start from the exact managed SHA")
  try {
    await git(repositoryRoot, ["merge", "--no-edit", "--no-ff", sourceSha])
  } catch {
    await git(repositoryRoot, ["reset", "--hard", managedSha])
    if (await git(repositoryRoot, ["rev-parse", "HEAD"]) !== managedSha || (await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) !== "") throw new Error("merge conflict cleanup did not restore the exact managed tree")
    return { status: MERGE_STATUS.BLOCKED, blockedReason: MERGE_BLOCK_REASON.MERGE_CONFLICT, managedSha, sourceSha }
  }
  return { status: MERGE_STATUS.MERGED, mergeCommitSha: await git(repositoryRoot, ["rev-parse", "HEAD"]), managedSha, sourceSha }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const values = { repositoryRoot: readArgument("--repository-root") ?? process.cwd(), managedSha: readArgument("--managed-sha"), sourceSha: readArgument("--source-sha") }
  if (Object.values(values).some((value) => value === undefined)) throw new Error("usage: merge-candidate.mjs --managed-sha <sha> --source-sha <sha>")
  process.stdout.write(`${JSON.stringify(await mergeCandidate(values))}\n`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown candidate merge failure")
    process.exitCode = 1
  })
}
