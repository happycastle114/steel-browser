import { createHash } from "node:crypto"

import { canonicalJson } from "./canonical-json.js"
import type { ProductionDependencyAuditReceiptCandidate } from "./production-dependency-audit-receipt.js"
import {
  PRODUCTION_DEPENDENCY_AUDIT_TARGET,
  PRODUCTION_DEPENDENCY_PACKAGE_KIND,
} from "./production-dependency-audit-vocabulary.js"

type PolicyIssue = {
  readonly message: string
  readonly path: readonly (number | string)[]
}

const TARGET_POLICY = {
  [PRODUCTION_DEPENDENCY_AUDIT_TARGET.WORKER]: {
    workspacePackages: [
      { name: "@happycastle/steel-managed-shared", sourceLocation: "managed/shared" },
      { name: "@happycastle/steel-managed-worker", sourceLocation: "managed/worker" },
      { name: "@steel-browser/api", sourceLocation: "api" },
    ],
    nativeOverlays: [
      { name: "classic-level", version: "2.0.0", location: "node_modules/classic-level" },
      { name: "duckdb", version: "1.4.2", location: "node_modules/duckdb" },
    ],
  },
  [PRODUCTION_DEPENDENCY_AUDIT_TARGET.MANAGER]: {
    workspacePackages: [
      { name: "@happycastle/steel-managed-gateway", sourceLocation: "managed/gateway" },
      { name: "@happycastle/steel-managed-manager", sourceLocation: "managed/manager" },
      { name: "@happycastle/steel-managed-shared", sourceLocation: "managed/shared" },
    ],
    nativeOverlays: [],
  },
} as const

function stringsAreUniqueAndSorted(values: readonly string[]): boolean {
  return values.every((value, index) => {
    const previous = values[index - 1]
    return index === 0 || (previous !== undefined && previous < value)
  })
}

export function productionDependencyAuditPolicyIssues(
  receipt: ProductionDependencyAuditReceiptCandidate,
): readonly PolicyIssue[] {
  const issues: PolicyIssue[] = []
  const policy = TARGET_POLICY[receipt.target]
  const expectedWorkspaces = policy.workspacePackages.map((workspace) => workspace.name)
  const workspacesAreExact = receipt.install.workspaces.length === expectedWorkspaces.length &&
    receipt.install.workspaces.every((workspace, index) => workspace === expectedWorkspaces[index])
  if (!workspacesAreExact) {
    issues.push({ message: "target workspace policy drift", path: ["install", "workspaces"] })
  }

  const expectedOverlays = policy.nativeOverlays
  const overlaysAreExact = receipt.install.nativeOverlays.length === expectedOverlays.length &&
    receipt.install.nativeOverlays.every((overlay, index) => {
      const expected = expectedOverlays[index]
      return expected !== undefined && overlay.name === expected.name &&
        overlay.version === expected.version && overlay.location === expected.location
    })
  if (!overlaysAreExact) {
    issues.push({ message: "target native overlay policy drift", path: ["install", "nativeOverlays"] })
  }
  if (receipt.install.nativeOverlays.some((overlay) => overlay.builderTreeSha256 !== overlay.installedTreeSha256)) {
    issues.push({ message: "native overlay tree drift", path: ["install", "nativeOverlays"] })
  }

  const packages = receipt.inventory.packages
  const locations = packages.map((entry) => entry.location)
  if (!stringsAreUniqueAndSorted(locations)) {
    issues.push({ message: "inventory locations are not unique and sorted", path: ["inventory", "packages"] })
  }
  if (receipt.inventory.packageCount !== packages.length) {
    issues.push({ message: "inventory package count drift", path: ["inventory", "packageCount"] })
  }
  const inventorySha256 = createHash("sha256").update(canonicalJson(packages)).digest("hex")
  if (receipt.inventory.sha256 !== inventorySha256) {
    issues.push({ message: "inventory canonical digest drift", path: ["inventory", "sha256"] })
  }

  const workspacePackages = packages.filter((entry) => entry.kind === PRODUCTION_DEPENDENCY_PACKAGE_KIND.WORKSPACE)
  const workspacePolicyIsExact = workspacePackages.length === policy.workspacePackages.length &&
    policy.workspacePackages.every((expected) => workspacePackages.some((entry) =>
      entry.name === expected.name && entry.sourceLocation === expected.sourceLocation,
    ))
  if (!workspacePolicyIsExact) {
    issues.push({ message: "workspace source mapping drift", path: ["inventory", "packages"] })
  }

  const overlaysExistInInventory = receipt.install.nativeOverlays.every((overlay) => packages.some((entry) =>
    entry.kind === PRODUCTION_DEPENDENCY_PACKAGE_KIND.REGISTRY && entry.name === overlay.name &&
      entry.version === overlay.version && entry.location === overlay.location,
  ))
  if (!overlaysExistInInventory) {
    issues.push({ message: "native overlay missing from inventory", path: ["inventory", "packages"] })
  }

  const counts = receipt.audit.counts
  const countTotal = counts.info + counts.low + counts.moderate + counts.high + counts.critical
  if (counts.total !== countTotal) {
    issues.push({ message: "audit count total drift", path: ["audit", "counts", "total"] })
  }
  const installedLocations = new Set(locations)
  if (!stringsAreUniqueAndSorted(receipt.audit.residuals.map((residual) => residual.name))) {
    issues.push({ message: "residual names are not unique and sorted", path: ["audit", "residuals"] })
  }
  for (const [index, residual] of receipt.audit.residuals.entries()) {
    const advisorySourcesAreUniqueAndSorted = residual.advisorySources.every((source, sourceIndex, sources) => {
      const previous = sources[sourceIndex - 1]
      return sourceIndex === 0 || (previous !== undefined && previous < source)
    })
    if (!advisorySourcesAreUniqueAndSorted) {
      issues.push({ message: "residual advisory sources are not unique and sorted", path: ["audit", "residuals", index, "advisorySources"] })
    }
    if (!stringsAreUniqueAndSorted(residual.nodes)) {
      issues.push({ message: "residual nodes are not unique and sorted", path: ["audit", "residuals", index, "nodes"] })
    }
    if (residual.nodes.some((node) => installedLocations.has(node))) {
      issues.push({ message: "residual node is installed", path: ["audit", "residuals", index, "nodes"] })
    }
  }
  return issues
}
