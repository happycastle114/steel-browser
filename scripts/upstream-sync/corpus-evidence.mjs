import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import { DIGEST_PATTERN, UPSTREAM_SHA_PATTERN, sha256 } from "./corpus-schema.mjs"

const execFileAsync = promisify(execFile)

function assertObject(value, artifact) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${artifact} must be a JSON object`)
  return value
}

function assertExactKeys(value, keys, artifact) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${artifact} schema keys are not exact (expected=${expected.join(",")}; actual=${actual.join(",")})`)
}

function assertDigest(value, artifact) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) throw new Error(`${artifact} must contain a lowercase SHA-256 digest`)
}

function assertNonEmptyString(value, artifact) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${artifact} must be a non-empty string`)
}

function assertSafeRelativePath(value, artifact) {
  assertNonEmptyString(value, artifact)
  if (path.posix.isAbsolute(value) || value.split("/").includes("..") || value.includes("\\")) throw new Error(`${artifact} contains an unsafe relative path`)
}

export async function assertProvenance(provenance, upstreamSha, artifactTexts, { repositoryRoot, strict }) {
  if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance) || provenance.upstreamSha !== upstreamSha) throw new Error("observed observation provenance is not pinned to the requested upstream SHA")
  if (provenance.schemaVersion !== 1 || typeof provenance.gitHead !== "string" || !UPSTREAM_SHA_PATTERN.test(provenance.gitHead)) throw new Error("observation provenance gitHead is invalid")
  assertExactKeys(provenance, ["schemaVersion", "upstreamSha", "gitHead", "captureToolVersion", "runtimeExecutable", "runtimeArgs", "capturedAt", "runtimeIdentitySha256", "artifacts"], "observation provenance")
  if (provenance.runtimeExecutable !== "repository-owned-observation-runner-v1" || typeof provenance.captureToolVersion !== "string" || !Array.isArray(provenance.runtimeArgs) || provenance.runtimeArgs.length !== 0 || typeof provenance.capturedAt !== "string" || Number.isNaN(Date.parse(provenance.capturedAt)) || !Array.isArray(provenance.artifacts)) throw new Error("observation provenance runtime contract is invalid")
  if (strict && repositoryRoot !== undefined) {
    let isGitRepository = true
    try { await execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "--git-dir"]) } catch { isGitRepository = false }
    if (isGitRepository) {
      try { await execFileAsync("git", ["-C", repositoryRoot, "cat-file", "-e", `${provenance.gitHead}^{commit}`]) } catch { throw new Error(`observation provenance gitHead is not an object in the checked-out repository: ${provenance.gitHead}`) }
    }
  }
  const expectedArtifacts = [...artifactTexts.keys()].sort()
  const actualArtifacts = provenance.artifacts.map((entry) => entry?.path).sort()
  if (JSON.stringify(actualArtifacts) !== JSON.stringify(expectedArtifacts)) throw new Error("observation provenance artifact set does not match captured output")
  for (const entry of provenance.artifacts) {
    if (!entry || typeof entry.path !== "string") throw new Error(`observation provenance has an invalid artifact hash: ${String(entry?.path)}`)
    assertDigest(entry.sha256, `observation provenance ${entry.path}`)
    if (sha256(Buffer.from(artifactTexts.get(entry.path), "utf8")) !== entry.sha256) throw new Error(`observation provenance artifact hash drift: ${entry.path}`)
  }
  assertDigest(provenance.runtimeIdentitySha256, "observation provenance runtime identity hash")
  if (sha256(Buffer.from(artifactTexts.get("runtime-identity.json"), "utf8")) !== provenance.runtimeIdentitySha256) throw new Error("observation provenance runtime identity hash drift")
}

export function validateEvidenceManifest(text, upstreamSha, kind) {
  const value = assertObject(JSON.parse(text), `${kind.toLowerCase()} manifest`)
  const keys = kind === "LICENSE" ? ["schemaVersion", "upstreamSha", "manifestKind", "spdxLicense", "artifacts"] : ["schemaVersion", "upstreamSha", "manifestKind", "allowedPaths", "artifacts"]
  assertExactKeys(value, keys, `${kind.toLowerCase()} manifest`)
  if (value.schemaVersion !== 1 || value.upstreamSha !== upstreamSha || value.manifestKind !== kind || !Array.isArray(value.artifacts) || value.artifacts.length === 0) throw new Error(`${kind} evidence manifest contract is invalid`)
  if (kind === "LICENSE" && value.spdxLicense !== "Apache-2.0") throw new Error("LICENSE evidence must declare Apache-2.0")
  if (kind === "SCOPE" && (!Array.isArray(value.allowedPaths) || value.allowedPaths.length === 0 || value.allowedPaths.some((entry) => typeof entry !== "string" || entry.trim() === ""))) throw new Error("SCOPE evidence allowed paths are invalid")
  for (const artifact of value.artifacts) { assertObject(artifact, `${kind} evidence artifact`); assertExactKeys(artifact, ["path", "sha256", "bytes"], `${kind} evidence artifact`); assertSafeRelativePath(artifact.path, `${kind} evidence artifact path`); assertDigest(artifact.sha256, `${kind} evidence artifact hash`); if (!Number.isInteger(artifact.bytes) || artifact.bytes <= 0) throw new Error(`${kind} evidence artifact byte count is invalid`) }
  if (kind === "LICENSE" && !value.artifacts.some((artifact) => artifact.path === "LICENSE")) throw new Error("LICENSE evidence must pin the LICENSE file")
  return value
}

function scopePathMatches(allowedPath, changedPath) {
  const normalized = allowedPath.endsWith("/**") ? allowedPath.slice(0, -3) : allowedPath.replace(/\/$/u, "")
  return changedPath === normalized || changedPath.startsWith(`${normalized}/`)
}

export function assertScopeManifestCoversPaths(manifest, changedPaths) {
  if (!Array.isArray(manifest.allowedPaths) || !Array.isArray(changedPaths)) throw new Error("scope manifest path coverage inputs are invalid")
  const uncovered = changedPaths.filter((changedPath) => !manifest.allowedPaths.some((allowedPath) => scopePathMatches(allowedPath, changedPath)))
  if (uncovered.length > 0) throw new Error(`scope manifest does not cover changed paths: ${uncovered.join(", ")}`)
}
