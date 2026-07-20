import assert from "node:assert/strict"
import test from "node:test"

import { CHANGE_CATEGORY, classifyChangedPaths } from "./classify-upstream.mjs"

test("classification emits stable categories for API, browser, license, migration, and scope drift", () => {
  assert.deepEqual(
    classifyChangedPaths([
      "api/src/modules/sessions/sessions.routes.ts",
      "Dockerfile",
      "NOTICE",
      "api/prisma/migration.sql",
      "deploy/coolify/compose.yaml",
    ]),
    [
      CHANGE_CATEGORY.API,
      CHANGE_CATEGORY.BROWSER,
      CHANGE_CATEGORY.LICENSE,
      CHANGE_CATEGORY.MIGRATION,
      CHANGE_CATEGORY.SCOPE,
    ],
  )
})

test("classification does not claim a runtime category for documentation-only drift", () => {
  assert.deepEqual(classifyChangedPaths(["README.md", "docs/operations.md"]), [])
})
