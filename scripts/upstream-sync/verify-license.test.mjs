import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { verifyLicense } from "./verify-license.mjs"

const APACHE_HEADER = "  Apache License\n  Version 2.0, January 2004\n"

test("license verifier rejects a nested non-Apache package declaration", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-license-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, "package.json"), JSON.stringify({ license: "Apache-2.0" }))
  await writeFile(path.join(root, "LICENSE"), APACHE_HEADER)
  await mkdir(path.join(root, "nested"))
  await writeFile(path.join(root, "nested", "package.json"), JSON.stringify({ license: "MIT" }))

  await assert.rejects(verifyLicense(root), /package license drift: nested\/package\.json/)
})

test("license verifier accepts Apache package declarations and the root header", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-license-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, "package.json"), JSON.stringify({ license: "Apache-2.0" }))
  await writeFile(path.join(root, "LICENSE"), APACHE_HEADER)
  assert.deepEqual(await verifyLicense(root), { status: "VERIFIED", packages: 1, license: "Apache-2.0" })
})
