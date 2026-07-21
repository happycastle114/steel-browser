import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import yaml from "yaml"

const workflowPaths = [
  ".github/workflows/managed-release.yml",
  ".github/workflows/managed-upstream-sync.yml",
]

test("hydrates only DuckDB after script-free installs on exact toolchains", async () => {
  for (const workflowPath of workflowPaths) {
    const bytes = await readFile(new URL(`../../../${workflowPath}`, import.meta.url), "utf8")
    const workflow = yaml.parse(bytes)
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps)
    const installIndex = steps.findIndex(({ run }) => run === "npm ci --ignore-scripts")
    const hydrateIndex = steps.findIndex(
      ({ run }) => run === "npm rebuild duckdb --foreground-scripts",
    )
    const verifyIndex = steps.findIndex(({ name }) =>
      name === "Verify managed product and release boundaries" ||
      name === "Run managed compatibility gates",
    )
    const setupNode = steps.find(({ uses }) => uses === "actions/setup-node@v4")
    const rust = steps.find(({ name }) => name === "Install exact Rust toolchain")

    assert.equal(setupNode.with["node-version"], "22.23.1")
    assert.match(rust.run, /rustup toolchain install 1\.91\.1 --profile minimal/u)
    assert.ok(installIndex >= 0)
    assert.ok(hydrateIndex > installIndex)
    assert.ok(verifyIndex > hydrateIndex)
  }
})
