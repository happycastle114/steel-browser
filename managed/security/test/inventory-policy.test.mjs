import assert from "node:assert/strict";
import test from "node:test";

import {
  InventoryDecision,
  evaluateProductionInventory,
} from "../lib/inventory-policy.mjs";

const workerPolicy = {
  forbiddenPackages: ["typescript", "vite", "vitest"],
  requiredWorkspaces: [
    "@happycastle/steel-managed-shared",
    "@happycastle/steel-managed-worker",
    "@steel-browser/api",
  ],
  workspaceSources: {
    "@happycastle/steel-managed-shared": "managed/shared",
    "@happycastle/steel-managed-worker": "managed/worker",
    "@steel-browser/api": "api",
  },
};

const inventory = {
  packages: [
    {
      contentSha256: null,
      dependencyScope: null,
      integrity: null,
      kind: "WORKSPACE",
      location: "node_modules/@happycastle/steel-managed-shared",
      name: "@happycastle/steel-managed-shared",
      sourceLocation: "managed/shared",
      version: "0.0.0",
    },
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
      contentSha256: null,
      dependencyScope: null,
      integrity: null,
      kind: "WORKSPACE",
      location: "node_modules/@steel-browser/api",
      name: "@steel-browser/api",
      sourceLocation: "api",
      version: "0.5.2",
    },
    {
      contentSha256: "a".repeat(64),
      dependencyScope: "PRODUCTION",
      integrity: "sha512-runtime",
      kind: "REGISTRY",
      location: "node_modules/zod",
      name: "zod",
      sourceLocation: null,
      version: "3.25.76",
    },
  ],
};

test("returns PASS for a complete production-only inventory", () => {
  // Given the three worker runtime workspaces and a locked registry package.
  // When the inventory policy is evaluated.
  const result = evaluateProductionInventory({
    inventory,
    policy: workerPolicy,
  });

  // Then the exact production tree passes.
  assert.equal(result.decision, InventoryDecision.PASS);
});

test("returns BLOCK when a required workspace is missing", () => {
  // Given an inventory without the worker workspace.
  const mutated = {
    packages: inventory.packages.filter(
      (entry) => entry.name !== "@happycastle/steel-managed-worker",
    ),
  };

  // When the inventory policy is evaluated.
  const result = evaluateProductionInventory({
    inventory: mutated,
    policy: workerPolicy,
  });

  // Then the incomplete runtime tree blocks.
  assert.equal(result.decision, InventoryDecision.BLOCK);
  assert.deepEqual(result.missingWorkspaces, [
    "@happycastle/steel-managed-worker",
  ]);
});

test("does not accept a registry package in place of a required workspace", () => {
  // Given a registry package forged with the required workspace name.
  const mutated = {
    packages: inventory.packages.map((entry) =>
      entry.name === "@happycastle/steel-managed-worker"
        ? {
            ...entry,
            contentSha256: "b".repeat(64),
            dependencyScope: "PRODUCTION",
            integrity: "sha512-forged",
            kind: "REGISTRY",
            sourceLocation: null,
          }
        : entry,
    ),
  };

  // When the inventory policy is evaluated.
  const result = evaluateProductionInventory({
    inventory: mutated,
    policy: workerPolicy,
  });

  // Then only an exact repository workspace can satisfy the requirement.
  assert.equal(result.decision, InventoryDecision.BLOCK);
  assert.deepEqual(result.missingWorkspaces, [
    "@happycastle/steel-managed-worker",
  ]);
});

test("returns BLOCK when a build-only package survives prune", () => {
  // Given a production inventory polluted with Vite.
  const mutated = {
    packages: [
      ...inventory.packages,
      {
        contentSha256: "c".repeat(64),
        dependencyScope: "PRODUCTION",
        integrity: "sha512-build-only",
        kind: "REGISTRY",
        location: "node_modules/vite",
        name: "vite",
        sourceLocation: null,
        version: "6.4.3",
      },
    ],
  };

  // When the inventory policy is evaluated.
  const result = evaluateProductionInventory({
    inventory: mutated,
    policy: workerPolicy,
  });

  // Then the build dependency blocks the runtime image.
  assert.equal(result.decision, InventoryDecision.BLOCK);
  assert.deepEqual(result.forbiddenPackages, ["vite"]);
});

test("returns INVALID when a registry package lacks lockfile integrity", () => {
  // Given a registry package without an integrity binding.
  const mutated = {
    packages: inventory.packages.map((entry) =>
      entry.name === "zod" ? { ...entry, integrity: null } : entry,
    ),
  };

  // When the inventory policy is evaluated.
  const result = evaluateProductionInventory({
    inventory: mutated,
    policy: workerPolicy,
  });

  // Then unverifiable inventory evidence is invalid.
  assert.equal(result.decision, InventoryDecision.INVALID);
});
