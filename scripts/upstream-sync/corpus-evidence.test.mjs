import assert from "node:assert/strict"
import test from "node:test"

import { assertScopeManifestCoversPaths } from "./corpus-evidence.mjs"

test("scope evidence must cover every changed path at a path boundary", () => {
  const manifest = { allowedPaths: ["api", "managed/tests/upstream/**"] }
  assert.doesNotThrow(() => assertScopeManifestCoversPaths(manifest, ["api/src/routes.ts", "managed/tests/upstream/a/manifest.json"]))
  assert.throws(() => assertScopeManifestCoversPaths(manifest, ["apiary/index.ts"]), /does not cover changed paths/)
})
