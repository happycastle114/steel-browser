import assert from "node:assert/strict";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildNativeOverlayEvidence,
  hashDirectoryTree,
} from "../lib/native-overlay.mjs";

const createPackage = async (root, content) => {
  const packageDir = join(root, "node_modules", "duckdb");
  await mkdir(join(packageDir, "build"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "duckdb", version: "1.4.2" }),
  );
  await writeFile(join(packageDir, "build", "duckdb.node"), content);
  await chmod(join(packageDir, "build", "duckdb.node"), 0o755);
  return packageDir;
};

test("hashes native package trees without uid, gid, or mtime", async () => {
  // Given byte-identical package trees copied at different times.
  const builderRoot = await mkdtemp(join(tmpdir(), "steel-native-builder-"));
  const installedRoot = await mkdtemp(
    join(tmpdir(), "steel-native-installed-"),
  );
  const builderPackage = await createPackage(builderRoot, "native bytes");
  await mkdir(join(installedRoot, "node_modules"), { recursive: true });
  const installedPackage = join(installedRoot, "node_modules", "duckdb");
  await cp(builderPackage, installedPackage, { recursive: true });
  await utimes(
    join(installedPackage, "build", "duckdb.node"),
    new Date("2030-01-01T00:00:00Z"),
    new Date("2030-01-01T00:00:00Z"),
  );

  // When both directory trees are canonically hashed.
  const builderHash = await hashDirectoryTree(builderPackage);
  const installedHash = await hashDirectoryTree(installedPackage);

  // Then nondeterministic filesystem metadata cannot change the hash.
  assert.equal(builderHash, installedHash);
});

test("emits exact matching overlay evidence for the policy package", async () => {
  // Given two exact native package trees and one expected overlay.
  const builderRoot = await mkdtemp(join(tmpdir(), "steel-overlay-builder-"));
  const installedRoot = await mkdtemp(
    join(tmpdir(), "steel-overlay-installed-"),
  );
  const builderPackage = await createPackage(builderRoot, "native bytes");
  await mkdir(join(installedRoot, "node_modules"), { recursive: true });
  await cp(builderPackage, join(installedRoot, "node_modules", "duckdb"), {
    recursive: true,
  });

  // When the overlay evidence is generated through the real filesystem seam.
  const evidence = await buildNativeOverlayEvidence({
    builderRoot,
    expected: [
      {
        location: "node_modules/duckdb",
        name: "duckdb",
        version: "1.4.2",
      },
    ],
    installedRoot,
  });

  // Then identity and both equal tree hashes are retained.
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].builderTreeSha256.length, 64);
  assert.equal(evidence[0].builderTreeSha256, evidence[0].installedTreeSha256);
  assert.equal(evidence[0].location, "node_modules/duckdb");
});

test("rejects byte divergence between builder and installed overlays", async () => {
  // Given two policy-identical packages with different native bytes.
  const builderRoot = await mkdtemp(join(tmpdir(), "steel-diverge-builder-"));
  const installedRoot = await mkdtemp(
    join(tmpdir(), "steel-diverge-installed-"),
  );
  await createPackage(builderRoot, "builder bytes");
  await createPackage(installedRoot, "installed bytes");

  // When overlay evidence generation compares both trees.
  const action = buildNativeOverlayEvidence({
    builderRoot,
    expected: [
      {
        location: "node_modules/duckdb",
        name: "duckdb",
        version: "1.4.2",
      },
    ],
    installedRoot,
  });

  // Then divergent package bytes cannot produce a receipt input.
  await assert.rejects(action, /native overlay trees differ/);
});

test("rejects a native package symlink that escapes the package tree", async () => {
  // Given a native package containing an absolute external symlink.
  const root = await mkdtemp(join(tmpdir(), "steel-native-symlink-"));
  const packageDir = await createPackage(root, "native bytes");
  await symlink("/etc/passwd", join(packageDir, "external-link"));

  // When the package tree is hashed for overlay evidence.
  const action = hashDirectoryTree(packageDir);

  // Then external content cannot be smuggled through an equal link string.
  await assert.rejects(action, /native overlay filesystem tree is invalid/);
});

test("rejects an overlay package root symlink that escapes its install root", async () => {
  const builderRoot = await mkdtemp(join(tmpdir(), "steel-overlay-root-"));
  const installedRoot = await mkdtemp(join(tmpdir(), "steel-overlay-install-"));
  const externalRoot = await mkdtemp(join(tmpdir(), "steel-overlay-outside-"));
  const externalPackage = await createPackage(externalRoot, "native bytes");
  await mkdir(join(builderRoot, "node_modules"), { recursive: true });
  await symlink(externalPackage, join(builderRoot, "node_modules", "duckdb"));
  await createPackage(installedRoot, "native bytes");

  const action = buildNativeOverlayEvidence({
    builderRoot,
    expected: [
      {
        location: "node_modules/duckdb",
        name: "duckdb",
        version: "1.4.2",
      },
    ],
    installedRoot,
  });

  await assert.rejects(action, /native overlay package escapes root/);
});
