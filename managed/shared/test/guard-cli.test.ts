import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const TSX_BINARY = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url))
const TEMPORARY_WORKING_DIRECTORY = "/tmp"

function runGuard(script: string): ReturnType<typeof spawnSync> {
  return spawnSync(TSX_BINARY, [fileURLToPath(new URL(`../src/${script}`, import.meta.url))], {
    cwd: TEMPORARY_WORKING_DIRECTORY,
    encoding: "utf8",
    env: process.env,
  })
}

describe("repository guard CLIs", () => {
  it.each([
    ["raw-state-comparison-cli.ts", "RAW_STATE_COMPARISONS_VERIFIED"],
    ["type-safety-guard-cli.ts", "MANAGED_TYPE_SAFETY_VERIFIED"],
  ])(
    "locates the repository independently of cwd: %s",
    (script, status) => {
      // Given: the guard process starts outside the Steel repository.
      expect(REPOSITORY_ROOT).not.toBe(TEMPORARY_WORKING_DIRECTORY)
      // When: the default guard command resolves its module-owned repository root.
      const result = runGuard(script)
      // Then: the complete repository scan succeeds from the unrelated cwd.
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" })
      expect(result.stdout).toContain(status)
    },
    15_000,
  )
})
