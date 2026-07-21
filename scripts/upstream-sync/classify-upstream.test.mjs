import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { CHANGE_CATEGORY, classifyChangedPaths, reviewSubjectSha256, validateReviewAcknowledgement } from "./classify-upstream.mjs"

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

test("review acknowledgement binds a stable source review subject and actual evidence bytes", () => {
  const evidenceBytes = Buffer.from("review evidence\n", "utf8")
  const value = {
    schemaVersion: 1,
    sourceSha: "a".repeat(40),
    reviewSubjectSha256: "0".repeat(64),
    diffSha256: "c".repeat(64),
    evidencePath: "managed/tests/upstream-review-evidence/a.json",
    evidenceSha256: "2".repeat(64),
    categories: [CHANGE_CATEGORY.BROWSER, CHANGE_CATEGORY.DEPENDENCY],
    reviewedReasons: ["BROWSER_REVIEW_REQUIRED", "DEPENDENCY_REVIEW_REQUIRED"],
    reviewer: "maintainer@example.invalid",
    reviewedAt: "2026-07-20T00:00:00.000Z",
    decision: "ACKNOWLEDGED",
  }
  value.evidenceSha256 = createHash("sha256").update(evidenceBytes).digest("hex")
  value.reviewSubjectSha256 = reviewSubjectSha256(value)
  assert.equal(validateReviewAcknowledgement(value, { sourceSha: value.sourceSha, diffSha256: value.diffSha256, categories: value.categories, evidenceBytes }), value)
  assert.throws(() => validateReviewAcknowledgement({ ...value, diffSha256: "e".repeat(64) }, { sourceSha: value.sourceSha, diffSha256: value.diffSha256, categories: value.categories, evidenceBytes }), /topology binding/)
})
