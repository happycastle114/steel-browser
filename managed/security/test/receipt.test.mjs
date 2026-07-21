import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionAuditReceipt,
  canonicalJson,
  canonicalJsonBytes,
  currentRuntimePlatform,
  sha256Hex,
} from "../lib/receipt.mjs";

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

const runtimePlatform = currentRuntimePlatform();
const policy = {
  audit: { registryOrigin: "https://registry.npmjs.org", residuals: [] },
  platform: runtimePlatform,
  receiptKind: "STEEL_PRODUCTION_DEPENDENCY_AUDIT",
  runtime: {
    nodeImage:
      "node:22.23.1-bookworm@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nodeVersion: process.versions.node,
  },
  schemaVersion: 1,
};

const targetPolicy = {
  forbiddenPackages: [],
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
  workspaces: ["@happycastle/steel-managed-worker"],
  workspaceSources: {
    "@happycastle/steel-managed-worker": "managed/worker",
  },
};

test("builds a non-circular source-bound production audit receipt", () => {
  // Given exact audit, inventory, lock, native overlay, and runtime evidence.
  const auditBytes = canonicalJsonBytes(audit);
  const lockfileBytes = Buffer.from("lockfile fixture\n", "utf8");
  const nativeOverlays = [
    {
      builderTreeSha256: "b".repeat(64),
      installedTreeSha256: "b".repeat(64),
      location: "node_modules/duckdb",
      name: "duckdb",
      version: "1.4.2",
    },
  ];

  // When the canonical receipt is built.
  const receipt = buildProductionAuditReceipt({
    audit,
    auditBytes,
    auditObservedAt: "2026-07-21T00:00:00Z",
    inventory,
    lockfileBytes,
    nativeOverlays,
    npmVersion: "11.12.1",
    policy,
    sourceRevision: "a".repeat(40),
    sourceTreeSha256: "d".repeat(64),
    target: "WORKER",
    targetPolicy,
  });
  const receiptBytes = canonicalJsonBytes(receipt);

  // Then raw bytes are newline-terminated, externally hashable, and carry no image ID.
  assert.equal(receiptBytes.at(-1), 10);
  assert.equal(sha256Hex(receiptBytes).length, 64);
  assert.equal(receipt.audit.reachableCritical, 0);
  assert.equal(receipt.audit.reachableHigh, 0);
  assert.equal(
    receipt.inventory.sha256,
    sha256Hex(Buffer.from(canonicalJson(inventory.packages), "utf8")),
  );
  assert.notEqual(
    receipt.inventory.sha256,
    sha256Hex(canonicalJsonBytes(inventory.packages)),
  );
  assert.equal(receipt.install.nativeOverlays.length, 1);
  assert.deepEqual(receipt.source, {
    revision: "a".repeat(40),
    treeSha256: "d".repeat(64),
  });
  assert.equal(Object.hasOwn(receipt, "imageId"), false);
});

test("rejects a native overlay whose builder and installed trees differ", () => {
  // Given a native package overlay with mismatched artifact hashes.
  const action = () =>
    buildProductionAuditReceipt({
      audit,
      auditBytes: canonicalJsonBytes(audit),
      auditObservedAt: "2026-07-21T00:00:00Z",
      inventory,
      lockfileBytes: Buffer.from("lockfile fixture\n", "utf8"),
      nativeOverlays: [
        {
          builderTreeSha256: "b".repeat(64),
          installedTreeSha256: "c".repeat(64),
          location: "node_modules/duckdb",
          name: "duckdb",
          version: "1.4.2",
        },
      ],
      npmVersion: "11.12.1",
      policy,
      sourceRevision: "a".repeat(40),
      sourceTreeSha256: "d".repeat(64),
      target: "WORKER",
      targetPolicy,
    });

  // When the receipt is built, then divergent native trees are rejected.
  assert.throws(action, /native overlay evidence does not match policy/);
});

test("rejects placeholder source hashes", () => {
  // Given otherwise valid evidence with all-zero source identifiers.
  const action = () =>
    buildProductionAuditReceipt({
      audit,
      auditBytes: canonicalJsonBytes(audit),
      auditObservedAt: "2026-07-21T00:00:00Z",
      inventory,
      lockfileBytes: Buffer.from("lockfile fixture\n", "utf8"),
      nativeOverlays: [
        {
          builderTreeSha256: "b".repeat(64),
          installedTreeSha256: "b".repeat(64),
          location: "node_modules/duckdb",
          name: "duckdb",
          version: "1.4.2",
        },
      ],
      npmVersion: "11.12.1",
      policy,
      sourceRevision: "0".repeat(40),
      sourceTreeSha256: "0".repeat(64),
      target: "WORKER",
      targetPolicy,
    });

  // When the receipt is built, then documentation placeholders fail closed.
  assert.throws(action, /receipt evidence does not match policy/);
});
