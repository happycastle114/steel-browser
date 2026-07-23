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

test("promotes one immutable release artifact without rebuilding images", async () => {
  const bytes = await readFile(
    new URL("../../../.github/workflows/managed-promotion.yml", import.meta.url),
    "utf8",
  )
  const workflow = yaml.parse(bytes)

  assert.equal(workflow.name, "Managed Steel promotion")
  assert.deepEqual(workflow.on.push.branches, ["production"])
  assert.deepEqual(workflow.on.push.paths, ["deploy/coolify/promotion-request.json"])
  assert.deepEqual(workflow.permissions, { actions: "read", contents: "read" })
  assert.equal(workflow.concurrency["cancel-in-progress"], false)
  const steps = workflow.jobs.deploy.steps
  const download = steps.find(
    ({ uses }) => uses === "actions/download-artifact@v4",
  )
  const deploy = steps.find(
    ({ name }) => name === "Deploy the requested stopped Coolify project",
  )
  const validate = steps.find(
    ({ name }) => name === "Validate the explicit promotion request",
  )
  const verify = steps.find(
    ({ name }) => name === "Verify the immutable release artifact",
  )

  assert.equal(download.with.repository, "${{ github.repository }}")
  assert.equal(download.with["github-token"], "${{ github.token }}")
  assert.equal(
    download.with["run-id"],
    "${{ steps.request.outputs.release-run-id }}",
  )
  assert.match(deploy.run, /coolify-deploy-cli\.mjs --target-slot/u)
  assert.equal(deploy.env.COOLIFY_API_TOKEN, "${{ secrets.COOLIFY_API_TOKEN }}")
  assert.equal(
    deploy.env.STEEL_MANAGED_RELEASE_DIRECTORY,
    "${{ runner.temp }}/steel-managed-promotion",
  )
  assert.match(validate.run, /keys == \["releaseRevision"/u)
  assert.match(verify.run, /blue\/compose\.yml/u)
  assert.match(verify.run, /green\/compose\.yml/u)
  assert.match(verify.run, /blue\/chromium-seccomp\.json/u)
  assert.match(verify.run, /green\/chromium-seccomp\.json/u)
  assert.doesNotMatch(steps.map(({ run = "" }) => run).join("\n"), /docker build/u)

  const releaseBytes = await readFile(
    new URL("../../../.github/workflows/managed-release.yml", import.meta.url),
    "utf8",
  )
  const releaseWorkflow = yaml.parse(releaseBytes)
  assert.deepEqual(releaseWorkflow.on.push.paths.filter((path) => path.startsWith("deploy/coolify/")), [
    "deploy/coolify/README.md",
    "deploy/coolify/compose.blue.yml",
    "deploy/coolify/compose.green.yml",
    "deploy/coolify/chromium-seccomp.json",
  ])
})

test("builds the console into the sealed manager image directory", async () => {
  const [viteBytes, dockerfileBytes] = await Promise.all([
    readFile(new URL("../../console/vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../manager/image/Dockerfile", import.meta.url), "utf8"),
  ])

  assert.match(viteBytes, /outDir: "dist"/u)
  assert.match(dockerfileBytes, /asset-manifest-cli\.js managed\/console\/dist/u)
  assert.match(dockerfileBytes, /\/workspace\/managed\/console\/dist \/srv\/steel-console/u)
})

test("copies the console AI dependency into the sealed manager build stage", async () => {
  const dockerfileBytes = await readFile(
    new URL("../../manager/image/Dockerfile", import.meta.url),
    "utf8",
  )

  assert.match(
    dockerfileBytes,
    /COPY managed\/ai-client\/package\.json \.\/managed\/ai-client\/package\.json/u,
  )
  assert.match(dockerfileBytes, /COPY managed\/ai-client \.\/managed\/ai-client/u)
})

test("uses the registry platform manifest as the released config digest authority", async () => {
  for (const scriptPath of [
    "../../manager/image/build-reproducible.sh",
    "../../worker/image/build-reproducible.sh",
  ]) {
    const bytes = await readFile(new URL(scriptPath, import.meta.url), "utf8")

    assert.match(bytes, /^set -Eeuo pipefail$/mu)
    assert.match(bytes, /config_digest="\$\(jq -er '\.config\.digest' "\$\{platform_manifest\}"\)"/u)
    assert.match(bytes, /\[\[ "\$\{config_digest\}" =~ \^sha256:\[0-9a-f\]\{64\}\$ \]\]/u)
    assert.doesNotMatch(bytes, /containerimage\.config\.digest/u)
  }
})
