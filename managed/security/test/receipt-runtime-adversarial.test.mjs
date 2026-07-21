import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionAuditReceipt,
  canonicalJsonBytes,
  currentRuntimePlatform,
  RuntimeArchitecture,
  RuntimeOperatingSystem,
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
const runtimePlatform = currentRuntimePlatform();
const basePolicy = {
  audit: { registryOrigin: "https://registry.npmjs.org", residuals: [] },
  platform: runtimePlatform,
  receiptKind: "STEEL_PRODUCTION_DEPENDENCY_AUDIT",
  runtime: {
    nodeImage: `fixture@sha256:${"b".repeat(64)}`,
    nodeVersion: process.versions.node,
  },
  schemaVersion: 1,
};
const targetPolicy = {
  forbiddenPackages: [],
  ignoreScripts: true,
  includeWorkspaceRoot: false,
  nativeOverlays: [],
  requiredWorkspaces: ["fixture"],
  workspaceSources: { fixture: "fixture" },
  workspaces: ["fixture"],
};
const inventory = {
  packages: [
    {
      contentSha256: null,
      dependencyScope: null,
      integrity: null,
      kind: "WORKSPACE",
      location: "node_modules/fixture",
      name: "fixture",
      sourceLocation: "fixture",
      version: "1.0.0",
    },
  ],
};

const build = ({ platform = runtimePlatform, timestamp }) =>
  buildProductionAuditReceipt({
    audit,
    auditBytes: canonicalJsonBytes(audit),
    auditObservedAt: timestamp,
    inventory,
    lockfileBytes: Buffer.from("lockfile fixture\n", "utf8"),
    nativeOverlays: [],
    npmVersion: "11.12.1",
    policy: { ...basePolicy, platform },
    sourceRevision: "a".repeat(40),
    sourceTreeSha256: "d".repeat(64),
    target: "WORKER",
    targetPolicy,
  });

test("rejects an impossible RFC 3339 observation timestamp", () => {
  assert.throws(
    () => build({ timestamp: "2026-02-31T99:61:61Z" }),
    /receipt evidence does not match policy/,
  );
});

test("rejects a policy that claims another operating system", () => {
  const os =
    runtimePlatform.os === RuntimeOperatingSystem.LINUX
      ? RuntimeOperatingSystem.DARWIN
      : RuntimeOperatingSystem.LINUX;
  assert.throws(
    () =>
      build({
        platform: { ...runtimePlatform, os },
        timestamp: "2026-07-21T00:00:00Z",
      }),
    /receipt evidence does not match policy/,
  );
});

test("rejects a policy that claims another architecture", () => {
  const architecture =
    runtimePlatform.architecture === RuntimeArchitecture.AMD64
      ? RuntimeArchitecture.ARM64
      : RuntimeArchitecture.AMD64;
  assert.throws(
    () =>
      build({
        platform: { ...runtimePlatform, architecture },
        timestamp: "2026-07-21T00:00:00Z",
      }),
    /receipt evidence does not match policy/,
  );
});
