import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { canonicalJson } from "../src/canonical-json.js"
import {
  parseProductionDependencyAuditReceipt,
  ProductionDependencyAuditReceiptSchema,
} from "../src/production-dependency-audit-receipt.js"
import {
  inventoryForPackages,
  managerReceipt,
  receiptSha256,
  VERIFICATION_DATE,
  workerReceipt,
} from "./production-dependency-audit-fixture.js"

describe("production dependency audit receipt schema", () => {
  it.each([
    ["worker", workerReceipt],
    ["manager", managerReceipt],
  ])("parses the exact %s policy and deeply freezes it", (_name, buildReceipt) => {
    // Given: a target-specific V1 dependency audit receipt.
    const input = buildReceipt()

    // When: the receipt crosses the schema boundary.
    const parsed = parseProductionDependencyAuditReceipt(input)

    // Then: target policy data is accepted as immutable evidence.
    expect(parsed.target).toBe(input.target)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.inventory.packages)).toBe(true)
  })

  it.each([
    ["unknown top-level field", { selfHash: "a".repeat(64) }],
    ["final image identity", { finalImageId: `sha256:${"a".repeat(64)}` }],
    ["wrong kind", { kind: "DEPENDENCY_AUDIT" }],
    ["wrong revision width", { source: { revision: "a".repeat(64), treeSha256: "1".repeat(64) } }],
    ["wrong tree hash width", { source: { revision: "a".repeat(40), treeSha256: "1".repeat(40) } }],
    ["wrong platform", { platform: { os: "darwin", architecture: "arm64" } }],
    ["unpinned node image", { runtime: { ...workerReceipt().runtime, nodeImage: "node:22.23.1" } }],
    ["wrong Node base", { runtime: { ...workerReceipt().runtime, nodeImage: `node:22.23.1-alpine@sha256:${"b".repeat(64)}` } }],
    ["wrong Node version", { runtime: { ...workerReceipt().runtime, nodeVersion: "22.22.0" } }],
    ["invalid npm semver", { runtime: { ...workerReceipt().runtime, npmVersion: "v10" } }],
    ["noncanonical observation time", { audit: { ...workerReceipt().audit, observedAt: "2026-07-21T10:11:12Z" } }],
  ])("rejects %s", (_name, mutation) => {
    // Given: a structurally invalid receipt mutation.
    const input = { ...workerReceipt(), ...mutation }

    // When/Then: strict parsing rejects the mutation.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it("hashes the canonical package array without a trailing LF", () => {
    // Given: a digest over canonical package bytes with a forbidden trailing LF.
    const receipt = workerReceipt()
    const sha256WithLf = createHash("sha256")
      .update(`${canonicalJson(receipt.inventory.packages)}\n`)
      .digest("hex")
    const input = { ...receipt, inventory: { ...receipt.inventory, sha256: sha256WithLf } }

    // When/Then: nested inventory hashing rejects top-level receipt framing.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["workspace order", { workspaces: ["@steel-browser/api", "@happycastle/steel-managed-worker", "@happycastle/steel-managed-shared"] }],
    ["workspace root", { includeWorkspaceRoot: true }],
    ["install scripts", { ignoreScripts: false }],
    ["missing overlay", { nativeOverlays: workerReceipt().install.nativeOverlays.slice(0, 1) }],
    ["overlay order", { nativeOverlays: [...workerReceipt().install.nativeOverlays].reverse() }],
    ["overlay tree drift", { nativeOverlays: workerReceipt().install.nativeOverlays.map((overlay) => ({ ...overlay, installedTreeSha256: "0".repeat(64) })) }],
  ])("rejects worker install policy drift in %s", (_name, mutation) => {
    // Given: an otherwise valid worker receipt with install policy drift.
    const receipt = workerReceipt()
    const input = { ...receipt, install: { ...receipt.install, ...mutation } }

    // When/Then: the frozen target policy rejects it.
    expect(() => ProductionDependencyAuditReceiptSchema.parse(input)).toThrow()
  })

  it.each([
    ["manager overlay", { nativeOverlays: workerReceipt().install.nativeOverlays }],
    ["manager workspace", { workspaces: workerReceipt().install.workspaces }],
  ])("rejects manager install policy drift in %s", (_name, mutation) => {
    // Given: an otherwise valid manager receipt with install policy drift.
    const receipt = managerReceipt()
    const input = { ...receipt, install: { ...receipt.install, ...mutation } }

    // When/Then: the manager policy rejects it.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["package order", (packages: readonly unknown[]) => [...packages].reverse()],
    ["duplicate location", (packages: readonly unknown[]) => [...packages, packages[0]]],
  ])("rejects %s", (_name, mutatePackages) => {
    // Given: an inventory whose package locations are not sorted and unique.
    const receipt = workerReceipt()
    const packages = mutatePackages(receipt.inventory.packages)
    const input = { ...receipt, inventory: inventoryForPackages(packages) }

    // When/Then: parsing rejects the invalid inventory.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["package count", { packageCount: 99 }],
    ["inventory digest", { sha256: "0".repeat(64) }],
  ])("rejects an incorrect %s", (_name, mutation) => {
    // Given: inventory metadata that does not describe its canonical package array.
    const receipt = workerReceipt()
    const input = { ...receipt, inventory: { ...receipt.inventory, ...mutation } }

    // When/Then: parsing rejects the inconsistent inventory metadata.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["workspace integrity", { location: "api", name: "@steel-browser/api", version: "0.5.2", kind: "WORKSPACE", sourceLocation: "api", integrity: `sha512-${"A".repeat(86)}==` }],
    ["unsafe workspace source", { location: "api", name: "@steel-browser/api", version: "0.5.2", kind: "WORKSPACE", sourceLocation: "../api", integrity: null }],
    ["registry source location", { location: "node_modules/zod", name: "zod", version: "3.25.76", kind: "REGISTRY", sourceLocation: "node_modules/zod", integrity: `sha512-${"A".repeat(86)}==` }],
    ["registry null integrity", { location: "node_modules/zod", name: "zod", version: "3.25.76", kind: "REGISTRY", sourceLocation: null, integrity: null }],
  ])("rejects %s", (_name, invalidPackage) => {
    // Given: a package whose integrity contradicts its source kind.
    const receipt = workerReceipt()
    const input = { ...receipt, inventory: inventoryForPackages([invalidPackage]) }

    // When/Then: the discriminated package schema rejects it.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it("rejects workspace source mapping drift with otherwise consistent inventory metadata", () => {
    // Given: a fully rehashed inventory with one workspace lock target changed.
    const receipt = workerReceipt()
    const packages = receipt.inventory.packages.map((entry) =>
      entry.name === "@steel-browser/api" ? { ...entry, sourceLocation: "managed/shared" } : entry,
    )
    const input = { ...receipt, inventory: inventoryForPackages(packages) }

    // When/Then: the target-specific workspace source map rejects it.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it("requires every native overlay to exist in the canonical inventory", () => {
    // Given: a fully rehashed inventory without the declared DuckDB overlay package.
    const receipt = workerReceipt()
    const packages = receipt.inventory.packages.filter((entry) => entry.name !== "duckdb")
    const input = { ...receipt, inventory: inventoryForPackages(packages) }

    // When/Then: overlay-to-inventory binding rejects it.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["count total", { counts: { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 4 } }],
    ["reachable high", { reachableHigh: 1 }],
    ["reachable critical", { reachableCritical: 1 }],
    ["blocker", { blockers: ["installed-critical"] }],
  ])("rejects audit policy drift in %s", (_name, mutation) => {
    // Given: an audit report that violates promotion policy.
    const receipt = workerReceipt()
    const input = { ...receipt, audit: { ...receipt.audit, ...mutation } }

    // When/Then: parsing rejects it.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["empty advisory", { advisorySources: [] }],
    ["advisory order", { advisorySources: [20, 10] }],
    ["duplicate advisory", { advisorySources: [10, 10] }],
    ["nonpositive advisory", { advisorySources: [0] }],
    ["empty nodes", { nodes: [] }],
    ["node order", { nodes: ["node_modules/z", "node_modules/a"] }],
    ["duplicate node", { nodes: ["node_modules/a", "node_modules/a"] }],
    ["installed node", { nodes: ["node_modules/duckdb"] }],
    ["invalid expiry", { expiresOn: "2026-02-30" }],
  ])("rejects residual drift in %s", (_name, mutation) => {
    // Given: an invalid residual exception.
    const receipt = workerReceipt()
    const residual = { ...receipt.audit.residuals[0], ...mutation }
    const input = { ...receipt, audit: { ...receipt.audit, residuals: [residual] } }

    // When/Then: parsing rejects it.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["row order", [
      { ...workerReceipt().audit.residuals[0], name: "z-package" },
      { ...workerReceipt().audit.residuals[0], name: "a-package" },
    ]],
    ["duplicate row", [
      workerReceipt().audit.residuals[0],
      workerReceipt().audit.residuals[0],
    ]],
  ])("rejects residual %s", (_name, residuals) => {
    // Given: bounded residual rows without a unique canonical name order.
    const receipt = workerReceipt()
    const input = { ...receipt, audit: { ...receipt.audit, residuals } }

    // When/Then: parsing rejects ambiguous residual evidence.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it.each([
    ["residual rows", { residuals: Array.from({ length: 33 }, () => workerReceipt().audit.residuals[0]) }],
    ["advisory sources", { residuals: [{ ...workerReceipt().audit.residuals[0], advisorySources: Array.from({ length: 65 }, (_, index) => index + 1) }] }],
    ["residual nodes", { residuals: [{ ...workerReceipt().audit.residuals[0], nodes: Array.from({ length: 257 }, (_, index) => `node_modules/lockfile-only-${String(index).padStart(3, "0")}`) }] }],
  ])("bounds %s", (_name, mutation) => {
    // Given: a structurally valid but operationally unbounded exception collection.
    const receipt = workerReceipt()
    const input = { ...receipt, audit: { ...receipt.audit, ...mutation } }

    // When/Then: the promotion receipt rejects unbounded residual evidence.
    expect(() => parseProductionDependencyAuditReceipt(input)).toThrow()
  })

  it("does not embed verification-date-dependent state in the schema", () => {
    // Given: a structurally valid receipt and an independently hashed marker.
    const receipt = workerReceipt()

    // When: the schema parses without a caller verification date.
    const parsed = parseProductionDependencyAuditReceipt(receipt)

    // Then: the frozen contract remains independent of verifier state.
    expect(parsed.audit.residuals[0]?.expiresOn).toBe("2026-08-31")
    expect(receiptSha256(VERIFICATION_DATE)).toHaveLength(64)
  })
})
