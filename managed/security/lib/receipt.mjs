import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

import { AuditDecision, evaluateProductionAudit } from "./audit-policy.mjs";
import {
  evaluateProductionInventory,
  InventoryDecision,
} from "./inventory-policy.mjs";

export class ProductionAuditReceiptError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionAuditReceiptError";
  }
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;
const rfc3339Pattern =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?Z$/u;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export const RuntimeArchitecture = Object.freeze({
  AMD64: "amd64",
  ARM64: "arm64",
});

export const RuntimeOperatingSystem = Object.freeze({
  DARWIN: "darwin",
  LINUX: "linux",
  WINDOWS: "win32",
});

const NodeArchitecture = Object.freeze({
  ARM64: "arm64",
  X64: "x64",
});

const runtimeArchitectureByNode = Object.freeze({
  [NodeArchitecture.ARM64]: RuntimeArchitecture.ARM64,
  [NodeArchitecture.X64]: RuntimeArchitecture.AMD64,
});
const runtimeOperatingSystemByNode = Object.freeze(
  Object.fromEntries(
    Object.values(RuntimeOperatingSystem).map((operatingSystem) => [
      operatingSystem,
      operatingSystem,
    ]),
  ),
);

export const currentRuntimePlatform = () => ({
  architecture: runtimeArchitectureByNode[process.arch],
  os: runtimeOperatingSystemByNode[process.platform],
});

const isLeapYear = (year) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const daysInMonth = (year, month) =>
  [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];

const isRfc3339Timestamp = (value) => {
  if (typeof value !== "string") return false;
  const match = rfc3339Pattern.exec(value);
  if (match?.groups === undefined) return false;
  const parts = Object.fromEntries(
    Object.entries(match.groups).map(([name, part]) => [name, Number(part)]),
  );
  return (
    parts.month >= 1 &&
    parts.month <= 12 &&
    parts.day >= 1 &&
    parts.day <= daysInMonth(parts.year, parts.month) &&
    parts.hour >= 0 &&
    parts.hour <= 23 &&
    parts.minute >= 0 &&
    parts.minute <= 59 &&
    parts.second >= 0 &&
    parts.second <= 59
  );
};

const isNonZeroHash = (value, pattern) =>
  pattern.test(value) && !/^0+$/u.test(value);

export const canonicalJson = (value) => canonicalize(value);

export const canonicalJsonBytes = (value) =>
  Buffer.from(`${canonicalJson(value)}\n`, "utf8");

export const sha256Hex = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

const sameOverlay = (expected, actual) =>
  actual.name === expected.name &&
  actual.version === expected.version &&
  actual.location === expected.location &&
  sha256Pattern.test(actual.builderTreeSha256) &&
  actual.builderTreeSha256 === actual.installedTreeSha256;

const validateOverlays = (expected, actual) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  expected.every((entry, index) => sameOverlay(entry, actual[index]));

const receiptResiduals = (audit, residuals) =>
  residuals.map((residual) => ({
    advisorySources: residual.advisorySources,
    expiresOn: residual.expiresOn,
    name: residual.name,
    nodes: residual.nodes,
    reason: residual.reason,
    severity: audit.vulnerabilities[residual.name].severity.toUpperCase(),
  }));

export const buildProductionAuditReceipt = ({
  audit,
  auditBytes,
  auditObservedAt,
  inventory,
  lockfileBytes,
  nativeOverlays,
  npmVersion,
  policy,
  sourceRevision,
  sourceTreeSha256,
  target,
  targetPolicy,
}) => {
  const runtimePlatform = currentRuntimePlatform();
  if (
    policy.schemaVersion !== 1 ||
    !isNonZeroHash(sourceRevision, revisionPattern) ||
    !isNonZeroHash(sourceTreeSha256, sha256Pattern) ||
    !isRfc3339Timestamp(auditObservedAt) ||
    process.versions.node !== policy.runtime.nodeVersion ||
    runtimePlatform.architecture === undefined ||
    runtimePlatform.os === undefined ||
    runtimePlatform.architecture !== policy.platform.architecture ||
    runtimePlatform.os !== policy.platform.os ||
    !semverPattern.test(npmVersion)
  ) {
    throw new ProductionAuditReceiptError(
      "production audit receipt evidence does not match policy",
    );
  }
  if (!validateOverlays(targetPolicy.nativeOverlays, nativeOverlays)) {
    throw new ProductionAuditReceiptError(
      "native overlay evidence does not match policy",
    );
  }

  const inventoryResult = evaluateProductionInventory({
    inventory,
    policy: targetPolicy,
  });
  if (inventoryResult.decision !== InventoryDecision.PASS) {
    throw new ProductionAuditReceiptError("production inventory is not safe");
  }

  const auditResult = evaluateProductionAudit({
    audit,
    evaluationDate: auditObservedAt.slice(0, 10),
    inventory,
    policy: policy.audit,
  });
  if (auditResult.decision !== AuditDecision.PASS) {
    throw new ProductionAuditReceiptError("production audit is not safe");
  }

  const packagesBytes = Buffer.from(canonicalJson(inventory.packages), "utf8");
  return {
    audit: {
      blockers: [],
      counts: audit.metadata.vulnerabilities,
      observedAt: auditObservedAt,
      reachableCritical: 0,
      reachableHigh: 0,
      registryOrigin: policy.audit.registryOrigin,
      reportSha256: sha256Hex(auditBytes),
      residuals: receiptResiduals(audit, auditResult.residuals),
    },
    install: {
      ignoreScripts: targetPolicy.ignoreScripts,
      includeWorkspaceRoot: targetPolicy.includeWorkspaceRoot,
      nativeOverlays,
      packageLockSha256: sha256Hex(lockfileBytes),
      workspaces: targetPolicy.workspaces,
    },
    inventory: {
      packageCount: inventory.packages.length,
      packages: inventory.packages,
      sha256: sha256Hex(packagesBytes),
    },
    kind: policy.receiptKind,
    platform: policy.platform,
    runtime: {
      nodeImage: policy.runtime.nodeImage,
      nodeVersion: policy.runtime.nodeVersion,
      npmVersion,
    },
    schemaVersion: policy.schemaVersion,
    source: {
      revision: sourceRevision,
      treeSha256: sourceTreeSha256,
    },
    target,
  };
};
