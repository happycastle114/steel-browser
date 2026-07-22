import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"
import { GUARD_CLI_ARGUMENT } from "../src/guard-cli-arguments.js"

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const TSX_BINARY = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url))
const SAFE_FIXTURE = fileURLToPath(new URL("../src/retry-after.ts", import.meta.url))
const TEMPORARY_WORKING_DIRECTORY = "/tmp"

function runGuard(script: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    TSX_BINARY,
    [
      fileURLToPath(new URL(`../src/${script}`, import.meta.url)),
      GUARD_CLI_ARGUMENT.FIXTURE,
      SAFE_FIXTURE,
    ],
    {
      cwd: TEMPORARY_WORKING_DIRECTORY,
      encoding: "utf8",
      env: process.env,
    },
  )
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
      // When: the guard resolves its module-owned repository root for a bounded fixture scan.
      const result = runGuard(script)
      // Then: the real semantic guard succeeds from the unrelated cwd.
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" })
      expect(result.stdout).toContain(status)
      expect(result.stdout).toContain("files=1")
    },
    15_000,
  )
})
