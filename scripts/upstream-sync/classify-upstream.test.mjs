import assert from "node:assert/strict"
import test from "node:test"

import { CHANGE_CATEGORY, classifyChangedPaths, validateReviewAcknowledgement } from "./classify-upstream.mjs"

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

test("classification binds dependency and browser review to content markers, not only paths", () => {
  assert.deepEqual(
    classifyChangedPaths(["package.json", "docs/release-notes.md"], '+  "playwright": "1.0.0"\n+  "license": "Apache-2.0"'),
    [CHANGE_CATEGORY.BROWSER, CHANGE_CATEGORY.DEPENDENCY, CHANGE_CATEGORY.LICENSE],
  )
})

test("review acknowledgement binds source, managed, diff, evidence, categories, and reasons", () => {
  const value = {
    schemaVersion: 1,
    sourceSha: "a".repeat(40),
    managedSha: "b".repeat(40),
    diffSha256: "c".repeat(64),
    evidenceSha256: "d".repeat(64),
    categories: [CHANGE_CATEGORY.BROWSER, CHANGE_CATEGORY.DEPENDENCY],
    reviewedReasons: ["BROWSER_REVIEW_REQUIRED", "DEPENDENCY_REVIEW_REQUIRED"],
    reviewer: "maintainer@example.invalid",
    reviewedAt: "2026-07-20T00:00:00.000Z",
    decision: "ACKNOWLEDGED",
  }
  assert.equal(validateReviewAcknowledgement(value, { sourceSha: value.sourceSha, managedSha: value.managedSha, diffSha256: value.diffSha256, categories: value.categories }), value)
  assert.throws(() => validateReviewAcknowledgement({ ...value, diffSha256: "e".repeat(64) }, { sourceSha: value.sourceSha, managedSha: value.managedSha, diffSha256: value.diffSha256, categories: value.categories }), /topology binding/)
})
