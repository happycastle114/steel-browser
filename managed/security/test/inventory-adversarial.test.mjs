import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildProductionInventory } from "../lib/inventory-generator.mjs";

const registryLock = (name, version) => ({
  lockfileVersion: 3,
  packages: {
    fixture: { dependencies: { [name]: version } },
    [`node_modules/${name}`]: { integrity: `sha512-${name}`, version },
  },
});

test("rejects a manifestless package directory", async () => {
  const rootDir = await mkdtemp(
    join(tmpdir(), "steel-inventory-manifestless-"),
  );
  await mkdir(join(rootDir, "node_modules", "mystery"), { recursive: true });
  await writeFile(join(rootDir, "node_modules", "mystery", "payload.js"), "x");

  const action = buildProductionInventory({
    lockfile: registryLock("mystery", "1.0.0"),
    productionWorkspaceSources: ["fixture"],
    rootDir,
    scanRoots: ["node_modules"],
  });

  await assert.rejects(action, /package manifest is missing/);
});

test("binds installed registry payload bytes in the inventory", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "steel-inventory-bytes-"));
  const packageDir = join(rootDir, "node_modules", "zod");
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "zod", version: "3.25.76" }),
  );
  await writeFile(join(packageDir, "index.js"), "export const value = 1;\n");
  const options = {
    lockfile: registryLock("zod", "3.25.76"),
    productionWorkspaceSources: ["fixture"],
    rootDir,
    scanRoots: ["node_modules"],
  };

  const before = await buildProductionInventory(options);
  await writeFile(join(packageDir, "index.js"), "export const value = 2;\n");
  const after = await buildProductionInventory(options);

  assert.notEqual(
    before.packages[0].contentSha256,
    after.packages[0].contentSha256,
  );
});

test("rejects a scan root symlink that escapes the source root", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "steel-inventory-scan-root-"));
  const externalDir = await mkdtemp(
    join(tmpdir(), "steel-inventory-scan-out-"),
  );
  await mkdir(join(externalDir, "zod"), { recursive: true });
  await writeFile(
    join(externalDir, "zod", "package.json"),
    JSON.stringify({ name: "zod", version: "3.25.76" }),
  );
  await symlink(externalDir, join(rootDir, "node_modules"));

  const action = buildProductionInventory({
    lockfile: registryLock("zod", "3.25.76"),
    productionWorkspaceSources: ["fixture"],
    rootDir,
    scanRoots: ["node_modules"],
  });

  await assert.rejects(action, /scan root escapes source root/);
});
