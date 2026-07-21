import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import yaml from "yaml"

const workflowPaths = [
  ".github/workflows/managed-pr-gates.yml",
  ".github/workflows/managed-release.yml",
  ".github/workflows/managed-upstream-sync.yml",
]

test("keeps the manager Fastify runtime aligned with the root override", async () => {
  const [rootBytes, managerBytes] = await Promise.all([
    readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../manager/package.json", import.meta.url), "utf8"),
  ])
  const rootPackage = JSON.parse(rootBytes)
  const managerPackage = JSON.parse(managerBytes)

  assert.equal(managerPackage.dependencies.fastify, rootPackage.dependencies.fastify)
})

test("builds shared contracts before clean-runner API drift checks", async () => {
  const bytes = await readFile(
    new URL("../../gateway/package.json", import.meta.url),
    "utf8",
  )
  const gatewayPackage = JSON.parse(bytes)

  assert.equal(
    gatewayPackage.scripts["precheck:managed-api-drift"],
    "npm run build -w @happycastle/steel-managed-shared",
  )
})

test("publishes the canonical production-branch check contract", async () => {
  const bytes = await readFile(
    new URL("../../../.github/workflows/managed-pr-gates.yml", import.meta.url),
    "utf8",
  )
  const workflow = yaml.parse(bytes)

  assert.equal(workflow.name, "Managed pull request gates")
  assert.deepEqual(workflow.on.pull_request.branches, ["production"])
  assert.equal(workflow.jobs.gates.name, "gates")
  const verifyStep = workflow.jobs.gates.steps.find(
    ({ name }) => name === "Verify managed product and release boundaries",
  )
  assert.doesNotMatch(verifyStep.run, /^\s*npm run verify:managed-overlay\s*$/mu)
})

test("runs managed workspace tests serially on bounded CI runners", async () => {
  const bytes = await readFile(
    new URL("../../../package.json", import.meta.url),
    "utf8",
  )
  const rootPackage = JSON.parse(bytes)

  assert.deepEqual(rootPackage.scripts["test:managed"].split(" && "), [
    "npm run test -w @happycastle/steel-managed-shared",
    "npm run test -w @happycastle/steel-managed-worker",
    "npm run test -w @happycastle/steel-managed-gateway",
    "npm run test -w @happycastle/steel-managed-operations-client",
    "npm run test -w @happycastle/steel-managed-ai-client",
    "npm run test -w @happycastle/steel-managed-console",
    "npm run test -w @happycastle/steel-managed-manager",
    "npm run test:production-audit",
    "npm run test:production-audit-mutations",
  ])
})

test("runs shared guard fixtures without file-level CPU contention", async () => {
  const bytes = await readFile(
    new URL("../../shared/package.json", import.meta.url),
    "utf8",
  )
  const sharedPackage = JSON.parse(bytes)

  assert.equal(sharedPackage.scripts.test, "vitest run --no-file-parallelism")
})

test("keeps Chromium sandboxed while adapting ephemeral Ubuntu runners", async () => {
  for (const workflowPath of workflowPaths) {
    const bytes = await readFile(new URL(`../../../${workflowPath}`, import.meta.url), "utf8")
    const workflow = yaml.parse(bytes)
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps)
    const enableIndex = steps.findIndex(
      ({ name }) => name === "Enable Chromium sandbox on the ephemeral runner",
    )
    const verifyIndex = steps.findIndex(({ name }) =>
      name === "Verify managed product and release boundaries" ||
      name === "Run managed compatibility gates",
    )
    const restoreIndex = steps.findIndex(
      ({ name }) => name === "Restore the Ubuntu user-namespace restriction",
    )

    assert.ok(enableIndex >= 0)
    assert.ok(verifyIndex > enableIndex)
    assert.ok(restoreIndex > verifyIndex)
    assert.match(steps[enableIndex].run, /apparmor_restrict_unprivileged_userns/u)
    assert.match(steps[enableIndex].run, /echo 0 \| sudo tee/u)
    assert.match(steps[restoreIndex].run, /STEEL_CI_APPARMOR_USERNS_ORIGINAL/u)
  }
})

test("threads the private DBus session into every Chromium verification", async () => {
  const [environmentSource, cdpSource] = await Promise.all([
    readFile(new URL("../../../api/src/env.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../../api/src/services/cdp/cdp.service.ts", import.meta.url),
      "utf8",
    ),
  ])

  assert.match(environmentSource, /DBUS_SESSION_BUS_ADDRESS: z\.string\(\)\.optional\(\)/u)
  assert.match(environmentSource, /XDG_RUNTIME_DIR: z\.string\(\)\.optional\(\)/u)
  assert.match(cdpSource, /env\.DBUS_SESSION_BUS_ADDRESS/u)
  assert.match(cdpSource, /env\.XDG_RUNTIME_DIR/u)

  for (const workflowPath of workflowPaths) {
    const bytes = await readFile(new URL(`../../../${workflowPath}`, import.meta.url), "utf8")
    const workflow = yaml.parse(bytes)
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps)
    const verifyStep = steps.find(({ name }) =>
      name === "Verify managed product and release boundaries" ||
      name === "Run managed compatibility gates",
    )

    assert.match(verifyStep.run, /dbus-run-session -- npm run check:managed/u)
  }
})

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
