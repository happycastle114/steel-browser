import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { currentRuntimePlatform } from "../lib/receipt.mjs";

const execFileAsync = promisify(execFile);
const securityRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaces = [
  ["@happycastle/steel-managed-gateway", "managed/gateway"],
  ["@happycastle/steel-managed-manager", "managed/manager"],
  ["@happycastle/steel-managed-shared", "managed/shared"],
];

test("writes a distinct manager receipt without worker dependencies", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "steel-manager-cli-"));
  const lockPackages = {};
  for (const [name, source] of workspaces) {
    const workspaceDir = join(rootDir, source);
    const link = join(rootDir, "node_modules", ...name.split("/"));
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(dirname(link), { recursive: true });
    await writeFile(
      join(workspaceDir, "package.json"),
      JSON.stringify({ name, version: "0.0.0" }),
    );
    await symlink(workspaceDir, link);
    lockPackages[source] = { name, version: "0.0.0" };
    lockPackages[`node_modules/${name}`] = { link: true, resolved: source };
  }
  await writeFile(
    join(rootDir, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: lockPackages })}\n`,
  );
  const cleanAudit = {
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: {
        critical: 0,
        high: 0,
        info: 0,
        low: 0,
        moderate: 0,
        total: 0,
      },
    },
    vulnerabilities: {},
  };
  await writeFile(
    join(rootDir, "audit.json"),
    `${JSON.stringify(cleanAudit)}\n`,
  );
  await writeFile(join(rootDir, "native-overlays.json"), "[]\n");
  const workspaceSources = Object.fromEntries(
    workspaces.map(([name, source]) => [name, source]),
  );
  const policy = {
    audit: { registryOrigin: "https://registry.npmjs.org", residuals: [] },
    platform: currentRuntimePlatform(),
    receiptKind: "STEEL_PRODUCTION_DEPENDENCY_AUDIT",
    runtime: {
      nodeImage: `fixture@sha256:${"b".repeat(64)}`,
      nodeVersion: process.versions.node,
    },
    schemaVersion: 1,
    targets: {
      MANAGER: {
        forbiddenPackages: [],
        ignoreScripts: true,
        includeWorkspaceRoot: false,
        nativeOverlays: [],
        requiredWorkspaces: workspaces.map(([name]) => name),
        scanRoots: ["node_modules"],
        workspaces: workspaces.map(([name]) => name),
        workspaceSources,
      },
    },
  };
  await writeFile(join(rootDir, "policy.json"), `${JSON.stringify(policy)}\n`);
  const outputPath = join(rootDir, "manager-receipt.json");

  await execFileAsync(process.execPath, [
    join(securityRoot, "verify-production-audit.mjs"),
    "--target",
    "MANAGER",
    "--root",
    rootDir,
    "--policy",
    join(rootDir, "policy.json"),
    "--audit",
    join(rootDir, "audit.json"),
    "--audit-observed-at",
    "2026-07-21T00:00:00Z",
    "--native-overlays",
    join(rootDir, "native-overlays.json"),
    "--source-revision",
    "a".repeat(40),
    "--source-tree-sha256",
    "d".repeat(64),
    "--output",
    outputPath,
  ]);

  const receipt = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(receipt.target, "MANAGER");
  assert.equal(receipt.inventory.packageCount, 3);
  assert.deepEqual(
    receipt.inventory.packages.map((entry) => entry.name),
    workspaces.map(([name]) => name),
  );
  assert.equal(
    receipt.inventory.packages.some(
      (entry) => entry.name === "@happycastle/steel-managed-worker",
    ),
    false,
  );
});
