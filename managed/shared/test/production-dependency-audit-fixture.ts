import { createHash } from "node:crypto"

import { canonicalJson } from "../src/canonical-json.js"

export const SOURCE_REVISION = "a".repeat(40)
export const SOURCE_TREE_SHA256 = "1".repeat(64)
export const NODE_IMAGE = "docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37"
export const NODE_VERSION = "22.23.1"
export const NPM_VERSION = "10.9.4"
export const VERIFICATION_DATE = "2026-07-21"

const integrity = `sha512-${"A".repeat(86)}==`

const workerPackages = [
  { location: "api", name: "@steel-browser/api", version: "0.5.2", kind: "WORKSPACE", sourceLocation: "api", integrity: null },
  { location: "managed/shared", name: "@happycastle/steel-managed-shared", version: "0.0.0", kind: "WORKSPACE", sourceLocation: "managed/shared", integrity: null },
  { location: "managed/worker", name: "@happycastle/steel-managed-worker", version: "0.0.0", kind: "WORKSPACE", sourceLocation: "managed/worker", integrity: null },
  { location: "node_modules/classic-level", name: "classic-level", version: "2.0.0", kind: "REGISTRY", sourceLocation: null, integrity },
  { location: "node_modules/duckdb", name: "duckdb", version: "1.4.2", kind: "REGISTRY", sourceLocation: null, integrity },
] as const

const managerPackages = [
  { location: "managed/gateway", name: "@happycastle/steel-managed-gateway", version: "0.0.0", kind: "WORKSPACE", sourceLocation: "managed/gateway", integrity: null },
  { location: "managed/manager", name: "@happycastle/steel-managed-manager", version: "0.0.0", kind: "WORKSPACE", sourceLocation: "managed/manager", integrity: null },
  { location: "managed/shared", name: "@happycastle/steel-managed-shared", version: "0.0.0", kind: "WORKSPACE", sourceLocation: "managed/shared", integrity: null },
] as const

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function inventoryForPackages<const Packages extends readonly Record<string, unknown>[]>(packages: Packages) {
  return {
    sha256: sha256(canonicalJson(packages)),
    packageCount: packages.length,
    packages,
  }
}

export function workerReceipt() {
  return {
    schemaVersion: 1,
    kind: "STEEL_PRODUCTION_DEPENDENCY_AUDIT",
    target: "WORKER",
    source: { revision: SOURCE_REVISION, treeSha256: SOURCE_TREE_SHA256 },
    platform: { os: "linux", architecture: "amd64" },
    runtime: { nodeImage: NODE_IMAGE, nodeVersion: NODE_VERSION, npmVersion: NPM_VERSION },
    install: {
      workspaces: [
        "@happycastle/steel-managed-shared",
        "@happycastle/steel-managed-worker",
        "@steel-browser/api",
      ],
      includeWorkspaceRoot: false,
      ignoreScripts: true,
      packageLockSha256: "c".repeat(64),
      nativeOverlays: [
        {
          name: "classic-level",
          version: "2.0.0",
          location: "node_modules/classic-level",
          builderTreeSha256: "d".repeat(64),
          installedTreeSha256: "d".repeat(64),
        },
        {
          name: "duckdb",
          version: "1.4.2",
          location: "node_modules/duckdb",
          builderTreeSha256: "e".repeat(64),
          installedTreeSha256: "e".repeat(64),
        },
      ],
    },
    inventory: inventoryForPackages(workerPackages),
    audit: {
      registryOrigin: "https://registry.npmjs.org",
      observedAt: "2026-07-21T10:11:12.000Z",
      reportSha256: "f".repeat(64),
      counts: { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 },
      reachableCritical: 0,
      reachableHigh: 0,
      blockers: [],
      residuals: [
        {
          name: "lockfile-only-package",
          severity: "HIGH",
          advisorySources: [10, 20],
          nodes: ["node_modules/lockfile-only-package"],
          reason: "UNINSTALLED_LOCKFILE_ONLY",
          expiresOn: "2026-08-31",
        },
      ],
    },
  }
}

export function managerReceipt() {
  const receipt = workerReceipt()
  return {
    ...receipt,
    target: "MANAGER",
    install: {
      ...receipt.install,
      workspaces: [
        "@happycastle/steel-managed-gateway",
        "@happycastle/steel-managed-manager",
        "@happycastle/steel-managed-shared",
      ],
      nativeOverlays: [],
    },
    inventory: inventoryForPackages(managerPackages),
  }
}

export function canonicalReceiptBytes(receipt: unknown): string {
  return `${canonicalJson(receipt)}\n`
}

export function receiptSha256(rawBytes: string): string {
  return sha256(rawBytes)
}
