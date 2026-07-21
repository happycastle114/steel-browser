import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[0-9a-f]{40}$/u
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u
const CORE_ARTIFACTS = Object.freeze(["manifest.json", "observed-receipt.json", "rest.ndjson", "route-matrix.json", "runtime-identity.json", "session-id-verdict.json", "websocket.ndjson"])
const OPTIONAL_ARTIFACTS = Object.freeze(["license-manifest.json", "scope-manifest.json"])

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

async function show(repositoryRoot, commitSha, filePath) {
  return (await execFileAsync("git", ["-C", repositoryRoot, "show", `${commitSha}:${filePath}`], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 })).stdout
}

export async function verifyCaptureBinding({ repositoryRoot, commitSha, sourceSha, bindingPath }) {
  if (!SHA_PATTERN.test(commitSha) || !SHA_PATTERN.test(sourceSha)) throw new Error("capture binding commit/source SHA is invalid")
  const bindingBytes = await readFile(bindingPath)
  const binding = JSON.parse(bindingBytes.toString("utf8"))
  if (binding === null || typeof binding !== "object" || Array.isArray(binding) || binding.schemaVersion !== 1 || binding.upstreamSha !== sourceSha || binding.gitHead !== sourceSha || !Array.isArray(binding.artifacts)) {
    throw new Error("capture binding is not pinned to the exact source SHA")
  }
  const allowed = new Set([...CORE_ARTIFACTS, ...OPTIONAL_ARTIFACTS])
  const names = binding.artifacts.map((artifact) => artifact?.path).sort()
  if (CORE_ARTIFACTS.some((name) => !names.includes(name)) || names.some((name) => !allowed.has(name)) || new Set(names).size !== names.length) {
    throw new Error("capture binding artifact set is incomplete or unauthorized")
  }
  const corpusRoot = `managed/tests/upstream/${sourceSha}`
  for (const artifact of binding.artifacts) {
    if (typeof artifact.path !== "string" || typeof artifact.sha256 !== "string" || !DIGEST_PATTERN.test(artifact.sha256)) throw new Error("capture binding artifact digest is invalid")
    const candidateBytes = await show(repositoryRoot, commitSha, `${corpusRoot}/${artifact.path}`)
    if (sha256(candidateBytes) !== artifact.sha256) throw new Error(`candidate corpus differs from pre-untrusted capture: ${artifact.path}`)
  }
  const committedProvenance = await show(repositoryRoot, commitSha, `${corpusRoot}/observation-provenance.json`)
  if (sha256(committedProvenance) !== sha256(bindingBytes)) throw new Error("candidate provenance differs from pre-untrusted capture binding")
  return { status: "VERIFIED", commitSha, sourceSha, captureBindingSha256: sha256(bindingBytes), artifacts: names }
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
    sourceSha: readArgument("--source-sha"),
    bindingPath: readArgument("--binding"),
  }
  if (Object.values(values).some((value) => value === undefined)) throw new Error("usage: verify-capture-binding.mjs --commit-sha <sha> --source-sha <sha> --binding <path>")
  console.log(`UPSTREAM_CAPTURE_BINDING_VERIFIED ${JSON.stringify(await verifyCaptureBinding(values))}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown capture binding verification failure")
    process.exitCode = 1
  })
}
