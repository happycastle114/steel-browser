import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildProductionInventory } from "../lib/inventory-generator.mjs";
import { pruneNonProductionPackages } from "../lib/production-pruner.mjs";

const writePackage = async (rootDir, name, version) => {
  const packageDir = join(rootDir, "node_modules", name);
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name, version }),
  );
};

test("removes forbidden and production-unreachable packages", async () => {
  // Given safe runtime content plus orphaned build packages retained by npm.
  const rootDir = await mkdtemp(join(tmpdir(), "steel-pruner-"));
  await writePackage(rootDir, "vite", "6.4.3");
  await writePackage(rootDir, "esbuild", "0.28.1");
  await writePackage(rootDir, "rollup", "4.62.2");
  await writePackage(rootDir, "@esbuild/darwin-arm64", "0.28.1");
  await writePackage(rootDir, "@rollup/rollup-darwin-arm64", "4.62.2");
  await writePackage(rootDir, "zod", "3.25.76");
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      fixture: { dependencies: { zod: "3.25.76" } },
      "node_modules/vite": {
        dev: true,
        integrity: "sha512-vite",
        version: "6.4.3",
      },
      "node_modules/esbuild": {
        devOptional: true,
        integrity: "sha512-esbuild",
        version: "0.28.1",
      },
      "node_modules/rollup": {
        dev: true,
        integrity: "sha512-rollup",
        version: "4.62.2",
      },
      "node_modules/@esbuild/darwin-arm64": {
        devOptional: true,
        integrity: "sha512-esbuild-darwin",
        version: "0.28.1",
      },
      "node_modules/@rollup/rollup-darwin-arm64": {
        devOptional: true,
        integrity: "sha512-rollup-darwin",
        version: "4.62.2",
      },
      "node_modules/zod": {
        integrity: "sha512-zod",
        version: "3.25.76",
      },
    },
  };
  const inventory = await buildProductionInventory({
    allowDevelopmentPackages: true,
    lockfile,
    productionWorkspaceSources: ["fixture"],
    rootDir,
    scanRoots: ["node_modules"],
  });

  // When policy names and production reachability are pruned.
  const removed = await pruneNonProductionPackages({
    inventory,
    policy: { forbiddenPackages: ["vite"] },
    rootDir,
  });

  // Then every build-only package is removed while runtime Zod remains.
  assert.deepEqual(removed, [
    {
      location: "node_modules/@esbuild/darwin-arm64",
      name: "@esbuild/darwin-arm64",
      version: "0.28.1",
    },
    {
      location: "node_modules/@rollup/rollup-darwin-arm64",
      name: "@rollup/rollup-darwin-arm64",
      version: "4.62.2",
    },
    { location: "node_modules/esbuild", name: "esbuild", version: "0.28.1" },
    { location: "node_modules/rollup", name: "rollup", version: "4.62.2" },
    { location: "node_modules/vite", name: "vite", version: "6.4.3" },
  ]);
  await assert.rejects(access(join(rootDir, "node_modules", "vite")));
  await access(join(rootDir, "node_modules", "zod"));
  const prunedInventory = await buildProductionInventory({
    lockfile,
    productionWorkspaceSources: ["fixture"],
    rootDir,
    scanRoots: ["node_modules"],
  });
  assert.deepEqual(
    prunedInventory.packages.map((entry) => entry.name),
    ["zod"],
  );
});

test("refuses to prune a forbidden workspace link", async () => {
  // Given a forged policy that marks a workspace package as forbidden.
  const rootDir = await mkdtemp(join(tmpdir(), "steel-pruner-workspace-"));
  const workspaceDir = join(rootDir, "managed", "worker");
  await mkdir(workspaceDir, { recursive: true });
  const inventory = {
    packages: [
      {
        contentSha256: null,
        dependencyScope: null,
        integrity: null,
        kind: "WORKSPACE",
        location: "node_modules/@happycastle/steel-managed-worker",
        name: "@happycastle/steel-managed-worker",
        sourceLocation: "managed/worker",
        version: "0.0.0",
      },
    ],
  };

  // When the prune operation reaches a non-registry target.
  const action = pruneNonProductionPackages({
    inventory,
    policy: { forbiddenPackages: ["@happycastle/steel-managed-worker"] },
    rootDir,
  });

  // Then it fails before deleting any workspace content.
  await assert.rejects(action, /workspace packages cannot be pruned/);
  await access(workspaceDir);
});
