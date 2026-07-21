import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildProductionInventory } from "../lib/inventory-generator.mjs";

test("builds a lock-bound canonical inventory from the installed tree", async () => {
  // Given one workspace link and one registry package installed under node_modules.
  const rootDir = await mkdtemp(join(tmpdir(), "steel-inventory-"));
  await mkdir(join(rootDir, "managed", "worker"), { recursive: true });
  await mkdir(join(rootDir, "node_modules", "@happycastle"), {
    recursive: true,
  });
  await mkdir(join(rootDir, "node_modules", "zod"), { recursive: true });
  await writeFile(
    join(rootDir, "managed", "worker", "package.json"),
    JSON.stringify({
      name: "@happycastle/steel-managed-worker",
      sourceLocation: "managed/worker",
      version: "0.0.0",
    }),
  );
  await symlink(
    join(rootDir, "managed", "worker"),
    join(rootDir, "node_modules", "@happycastle", "steel-managed-worker"),
  );
  await writeFile(
    join(rootDir, "node_modules", "zod", "package.json"),
    JSON.stringify({ name: "zod", version: "3.25.76" }),
  );
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      "managed/worker": {
        dependencies: { zod: "3.25.76" },
        name: "@happycastle/steel-managed-worker",
        version: "0.0.0",
      },
      "node_modules/@happycastle/steel-managed-worker": {
        link: true,
        resolved: "managed/worker",
      },
      "node_modules/zod": {
        integrity: "sha512-runtime",
        version: "3.25.76",
      },
    },
  };

  // When the installed tree is resolved against package-lock v3.
  const result = await buildProductionInventory({
    lockfile,
    productionWorkspaceSources: ["managed/worker"],
    rootDir,
    scanRoots: ["node_modules"],
  });

  // Then locations, kinds, versions, and registry integrity are canonical.
  assert.deepEqual(result.packages, [
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
    {
      contentSha256: result.packages[1].contentSha256,
      dependencyScope: "PRODUCTION",
      integrity: "sha512-runtime",
      kind: "REGISTRY",
      location: "node_modules/zod",
      name: "zod",
      sourceLocation: null,
      version: "3.25.76",
    },
  ]);
  assert.match(result.packages[1].contentSha256, /^[a-f0-9]{64}$/u);
});

test("rejects an installed registry package that differs from the lock", async () => {
  // Given an installed package version not represented by the lockfile.
  const rootDir = await mkdtemp(join(tmpdir(), "steel-inventory-mismatch-"));
  await mkdir(join(rootDir, "node_modules", "zod"), { recursive: true });
  await writeFile(
    join(rootDir, "node_modules", "zod", "package.json"),
    JSON.stringify({ name: "zod", version: "4.0.0" }),
  );
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      fixture: { dependencies: { zod: "3.25.76" } },
      "node_modules/zod": {
        integrity: "sha512-runtime",
        version: "3.25.76",
      },
    },
  };

  // When inventory generation crosses the mismatched package boundary.
  const action = buildProductionInventory({
    lockfile,
    productionWorkspaceSources: ["fixture"],
    rootDir,
    scanRoots: ["node_modules"],
  });

  // Then the unverifiable installed tree is rejected.
  await assert.rejects(action, /does not match package-lock/);
});

test("rejects a registry manifest whose name differs from its install path", async () => {
  // Given a package directory whose manifest impersonates another package.
  const rootDir = await mkdtemp(join(tmpdir(), "steel-inventory-name-"));
  await mkdir(join(rootDir, "node_modules", "zod"), { recursive: true });
  await writeFile(
    join(rootDir, "node_modules", "zod", "package.json"),
    JSON.stringify({ name: "forged-package", version: "3.25.76" }),
  );
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      fixture: { dependencies: { zod: "3.25.76" } },
      "node_modules/zod": {
        integrity: "sha512-runtime",
        version: "3.25.76",
      },
    },
  };

  // When inventory generation reads the forged manifest.
  const action = buildProductionInventory({
    lockfile,
    productionWorkspaceSources: ["fixture"],
    rootDir,
    scanRoots: ["node_modules"],
  });

  // Then the location/name mismatch is rejected.
  await assert.rejects(action, /does not match package-lock/);
});

test("rejects a workspace symlink that escapes the source root", async () => {
  // Given a forged workspace link that points to matching metadata outside rootDir.
  const rootDir = await mkdtemp(join(tmpdir(), "steel-inventory-root-"));
  const externalDir = await mkdtemp(
    join(tmpdir(), "steel-inventory-external-"),
  );
  await mkdir(join(rootDir, "node_modules", "@happycastle"), {
    recursive: true,
  });
  await writeFile(
    join(externalDir, "package.json"),
    JSON.stringify({
      name: "@happycastle/steel-managed-worker",
      version: "0.0.0",
    }),
  );
  await symlink(
    externalDir,
    join(rootDir, "node_modules", "@happycastle", "steel-managed-worker"),
  );
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      "managed/worker": {
        name: "@happycastle/steel-managed-worker",
        version: "0.0.0",
      },
      "node_modules/@happycastle/steel-managed-worker": {
        link: true,
        resolved: "managed/worker",
      },
    },
  };

  // When inventory generation resolves the forged link.
  const action = buildProductionInventory({
    lockfile,
    productionWorkspaceSources: ["managed/worker"],
    rootDir,
    scanRoots: ["node_modules"],
  });

  // Then an external workspace cannot be attested as repository content.
  await assert.rejects(action, /workspace link escapes source root/);
});
