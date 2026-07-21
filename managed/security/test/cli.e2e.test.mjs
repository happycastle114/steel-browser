import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { currentRuntimePlatform } from "../lib/receipt.mjs";

const execFileAsync = promisify(execFile);
const securityRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const writeRegistryPackage = async (rootDir, name, version, payload) => {
  const packageDir = join(rootDir, "node_modules", name);
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name, version }),
  );
  await writeFile(join(packageDir, "index.js"), payload);
  return packageDir;
};

test("writes a canonical receipt from a real pruned filesystem fixture", async () => {
  // Given a lock-bound workspace install, clean audit report, and exact policy.
  const rootDir = await mkdtemp(join(tmpdir(), "steel-audit-cli-"));
  const workspaceDir = join(rootDir, "managed", "worker");
  const workspaceLink = join(
    rootDir,
    "node_modules",
    "@happycastle",
    "steel-managed-worker",
  );
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(dirname(workspaceLink), { recursive: true });
  await writeFile(
    join(workspaceDir, "package.json"),
    JSON.stringify({
      name: "@happycastle/steel-managed-worker",
      version: "0.0.0",
    }),
  );
  await symlink(workspaceDir, workspaceLink);
  const duckdbPackage = await writeRegistryPackage(
    rootDir,
    "duckdb",
    "1.4.2",
    "native bytes\n",
  );
  await writeRegistryPackage(rootDir, "vite", "6.4.3", "build only\n");
  await writeRegistryPackage(rootDir, "zod", "3.25.76", "runtime\n");
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      "managed/worker": {
        dependencies: { duckdb: "1.4.2", zod: "3.25.76" },
        name: "@happycastle/steel-managed-worker",
        version: "0.0.0",
      },
      "node_modules/@happycastle/steel-managed-worker": {
        link: true,
        resolved: "managed/worker",
      },
      "node_modules/duckdb": {
        integrity: "sha512-duckdb",
        version: "1.4.2",
      },
      "node_modules/vite": {
        dev: true,
        integrity: "sha512-vite",
        version: "6.4.3",
      },
      "node_modules/zod": {
        integrity: "sha512-zod",
        version: "3.25.76",
      },
    },
  };
  await writeFile(
    join(rootDir, "package-lock.json"),
    `${JSON.stringify(lockfile)}\n`,
  );
  const audit = {
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
  await writeFile(join(rootDir, "audit.json"), `${JSON.stringify(audit)}\n`);
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
      WORKER: {
        forbiddenPackages: ["vite"],
        ignoreScripts: true,
        includeWorkspaceRoot: false,
        nativeOverlays: [
          {
            location: "node_modules/duckdb",
            name: "duckdb",
            version: "1.4.2",
          },
        ],
        requiredWorkspaces: ["@happycastle/steel-managed-worker"],
        scanRoots: ["node_modules"],
        workspaces: ["@happycastle/steel-managed-worker"],
        workspaceSources: {
          "@happycastle/steel-managed-worker": "managed/worker",
        },
      },
    },
  };
  await writeFile(join(rootDir, "policy.json"), `${JSON.stringify(policy)}\n`);
  const builderRoot = await mkdtemp(join(tmpdir(), "steel-audit-builder-"));
  await mkdir(join(builderRoot, "node_modules"), { recursive: true });
  await cp(duckdbPackage, join(builderRoot, "node_modules", "duckdb"), {
    recursive: true,
  });
  const overlayPath = join(rootDir, "native-overlays.json");
  const outputPath = join(rootDir, "receipt.json");

  // When the real pruner, overlay, and verifier CLIs run in pipeline order.
  const pruneResult = await execFileAsync(process.execPath, [
    join(securityRoot, "prune-production-tree.mjs"),
    "--target",
    "WORKER",
    "--root",
    rootDir,
    "--policy",
    join(rootDir, "policy.json"),
  ]);
  assert.deepEqual(JSON.parse(pruneResult.stdout).removed, [
    { location: "node_modules/vite", name: "vite", version: "6.4.3" },
  ]);
  await assert.rejects(access(join(rootDir, "node_modules", "vite")));

  await execFileAsync(process.execPath, [
    join(securityRoot, "generate-native-overlay-evidence.mjs"),
    "--target",
    "WORKER",
    "--builder-root",
    builderRoot,
    "--installed-root",
    rootDir,
    "--policy",
    join(rootDir, "policy.json"),
    "--output",
    overlayPath,
  ]);
  const overlays = JSON.parse(await readFile(overlayPath, "utf8"));
  assert.equal(overlays.length, 1);
  assert.match(overlays[0].installedTreeSha256, /^[a-f0-9]{64}$/u);

  await execFileAsync(process.execPath, [
    join(securityRoot, "verify-production-audit.mjs"),
    "--target",
    "WORKER",
    "--root",
    rootDir,
    "--policy",
    join(rootDir, "policy.json"),
    "--audit",
    join(rootDir, "audit.json"),
    "--audit-observed-at",
    "2026-07-21T00:00:00Z",
    "--native-overlays",
    overlayPath,
    "--source-revision",
    "a".repeat(40),
    "--source-tree-sha256",
    "d".repeat(64),
    "--output",
    outputPath,
  ]);

  // Then a newline-terminated, source-bound receipt is written atomically.
  const bytes = await readFile(outputPath);
  const receipt = JSON.parse(bytes.toString("utf8"));
  assert.equal(bytes.at(-1), 10);
  assert.deepEqual(receipt.source, {
    revision: "a".repeat(40),
    treeSha256: "d".repeat(64),
  });
  assert.equal(receipt.target, "WORKER");
  assert.equal(receipt.inventory.packageCount, 3);
});
