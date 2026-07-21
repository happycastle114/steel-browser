import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { loadReviewedGateManifest } from "./reviewed-gate-manifest.mjs"
import { verifyPackageScripts } from "./verify-package-scripts.mjs"

test("reviewed gate manifest is exact and current package scripts are bound", async () => {
  const manifest = await loadReviewedGateManifest(process.cwd())
  assert.equal(manifest.schemaVersion, 1)
  assert.deepEqual(await verifyPackageScripts(), { status: "VERIFIED", packageCount: 7 })
})

test("package script neutralization fails independently of direct gate operations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-gate-manifest-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, ".github"), { recursive: true })
  await writeFile(path.join(root, ".github", "managed-gate-manifest.json"), await readFile(path.resolve(".github/managed-gate-manifest.json")))
  const manifest = await loadReviewedGateManifest(root)
  for (const [packagePath, scripts] of Object.entries(manifest.packageScripts)) {
    await mkdir(path.dirname(path.join(root, packagePath)), { recursive: true })
    await writeFile(path.join(root, packagePath), `${JSON.stringify({ scripts })}\n`)
  }
  for (const [relativePackagePath, scripts] of Object.entries(manifest.packageScripts)) {
    const packagePath = path.join(root, relativePackagePath)
    for (const scriptName of Object.keys(scripts)) {
      const packageValue = JSON.parse(await readFile(packagePath, "utf8"))
      const original = packageValue.scripts[scriptName]
      packageValue.scripts[scriptName] = "true"
      await writeFile(packagePath, `${JSON.stringify(packageValue)}\n`)
      await assert.rejects(verifyPackageScripts(root), new RegExp(`reviewed package script drift: ${relativePackagePath.replaceAll(".", "\\.")}#${scriptName.replaceAll(":", "\\:")}`))
      packageValue.scripts[scriptName] = original
      await writeFile(packagePath, `${JSON.stringify(packageValue)}\n`)
    }
  }
  for (const operations of Object.values(manifest.gates)) {
    assert.equal(operations.some((operation) => operation.executable === "true"), false)
  }
})
