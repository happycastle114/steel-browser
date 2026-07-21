import { z } from "zod"

import { GitCommitShaSchema, IsoTimeSchema, Sha256Schema } from "./control-plane-primitives.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"
import { productionDependencyAuditPolicyIssues } from "./production-dependency-audit-policy.js"
import {
  PRODUCTION_DEPENDENCY_AUDIT,
  PRODUCTION_DEPENDENCY_AUDIT_PLATFORM,
  PRODUCTION_DEPENDENCY_AUDIT_SEVERITY,
  PRODUCTION_DEPENDENCY_AUDIT_TARGET,
  PRODUCTION_DEPENDENCY_PACKAGE_KIND,
} from "./production-dependency-audit-vocabulary.js"

export {
  PRODUCTION_DEPENDENCY_AUDIT,
  PRODUCTION_DEPENDENCY_AUDIT_PLATFORM,
  PRODUCTION_DEPENDENCY_AUDIT_SEVERITY,
  PRODUCTION_DEPENDENCY_AUDIT_TARGET,
  PRODUCTION_DEPENDENCY_PACKAGE_KIND,
} from "./production-dependency-audit-vocabulary.js"

const SEMVER_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const PACKAGE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,255}$/u
const SAFE_RELATIVE_LOCATION_PATTERN = /^[A-Za-z0-9@_+.-]+(?:\/[A-Za-z0-9@_+.-]+)*$/u
const DOT_SEGMENT_PATTERN = /(?:^|\/)\.{1,2}(?:\/|$)/u
const SHA512_INTEGRITY_PATTERN = /^sha512-(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/u
const CALENDAR_DATE_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/u

function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

const PackageNameSchema = z.string().regex(PACKAGE_NAME_PATTERN)
const PackageVersionSchema = z.string().regex(PACKAGE_VERSION_PATTERN)
const RelativeLocationSchema = z.string()
  .regex(SAFE_RELATIVE_LOCATION_PATTERN)
  .refine((value) => !DOT_SEGMENT_PATTERN.test(value))
const UintSchema = z.number().int().safe().nonnegative()
const PositiveUintSchema = z.number().int().safe().positive()

export const ProductionDependencyAuditDateSchema = z.string()
  .regex(CALENDAR_DATE_PATTERN)
  .refine(isCalendarDate)
  .brand("ProductionDependencyAuditDate")

export const ProductionDependencyAuditSourceSchema = z.object({
  revision: GitCommitShaSchema,
  treeSha256: Sha256Schema,
}).strict()

export const ProductionDependencyAuditRuntimeSchema = z.object({
  nodeImage: z.literal(PRODUCTION_DEPENDENCY_AUDIT.NODE_IMAGE),
  nodeVersion: z.literal(PRODUCTION_DEPENDENCY_AUDIT.NODE_VERSION),
  npmVersion: z.string().regex(SEMVER_PATTERN).brand("NpmVersion"),
}).strict()

const WorkspacePackageSchema = z.object({
  location: RelativeLocationSchema,
  name: PackageNameSchema,
  version: PackageVersionSchema,
  kind: z.literal(PRODUCTION_DEPENDENCY_PACKAGE_KIND.WORKSPACE),
  sourceLocation: RelativeLocationSchema,
  integrity: z.null(),
}).strict()

const RegistryPackageSchema = z.object({
  location: RelativeLocationSchema,
  name: PackageNameSchema,
  version: PackageVersionSchema,
  kind: z.literal(PRODUCTION_DEPENDENCY_PACKAGE_KIND.REGISTRY),
  sourceLocation: z.null(),
  integrity: z.string().regex(SHA512_INTEGRITY_PATTERN),
}).strict()

const InventoryPackageSchema = z.discriminatedUnion("kind", [
  WorkspacePackageSchema,
  RegistryPackageSchema,
])

const NativeOverlaySchema = z.object({
  name: PackageNameSchema,
  version: PackageVersionSchema,
  location: RelativeLocationSchema,
  builderTreeSha256: Sha256Schema,
  installedTreeSha256: Sha256Schema,
}).strict()

const ResidualSchema = z.object({
  name: PackageNameSchema,
  severity: z.enum([
    PRODUCTION_DEPENDENCY_AUDIT_SEVERITY.HIGH,
    PRODUCTION_DEPENDENCY_AUDIT_SEVERITY.CRITICAL,
  ]),
  advisorySources: z.array(PositiveUintSchema)
    .min(1)
    .max(PRODUCTION_DEPENDENCY_AUDIT.MAX_RESIDUAL_ADVISORY_SOURCES)
    .readonly(),
  nodes: z.array(RelativeLocationSchema)
    .min(1)
    .max(PRODUCTION_DEPENDENCY_AUDIT.MAX_RESIDUAL_NODES)
    .readonly(),
  reason: z.literal(PRODUCTION_DEPENDENCY_AUDIT.RESIDUAL_REASON),
  expiresOn: ProductionDependencyAuditDateSchema,
}).strict()

const CountsSchema = z.object({
  info: UintSchema,
  low: UintSchema,
  moderate: UintSchema,
  high: UintSchema,
  critical: UintSchema,
  total: UintSchema,
}).strict()

const ReceiptBaseSchema = z.object({
  schemaVersion: z.literal(PRODUCTION_DEPENDENCY_AUDIT.SCHEMA_VERSION),
  kind: z.literal(PRODUCTION_DEPENDENCY_AUDIT.KIND),
  target: z.enum([
    PRODUCTION_DEPENDENCY_AUDIT_TARGET.WORKER,
    PRODUCTION_DEPENDENCY_AUDIT_TARGET.MANAGER,
  ]),
  source: ProductionDependencyAuditSourceSchema,
  platform: z.object({
    os: z.literal(PRODUCTION_DEPENDENCY_AUDIT_PLATFORM.OS),
    architecture: z.literal(PRODUCTION_DEPENDENCY_AUDIT_PLATFORM.ARCHITECTURE),
  }).strict(),
  runtime: ProductionDependencyAuditRuntimeSchema,
  install: z.object({
    workspaces: z.array(PackageNameSchema).readonly(),
    includeWorkspaceRoot: z.literal(false),
    ignoreScripts: z.literal(true),
    packageLockSha256: Sha256Schema,
    nativeOverlays: z.array(NativeOverlaySchema).readonly(),
  }).strict(),
  inventory: z.object({
    sha256: Sha256Schema,
    packageCount: UintSchema,
    packages: z.array(InventoryPackageSchema).readonly(),
  }).strict(),
  audit: z.object({
    registryOrigin: z.literal(PRODUCTION_DEPENDENCY_AUDIT.REGISTRY_ORIGIN),
    observedAt: IsoTimeSchema,
    reportSha256: Sha256Schema,
    counts: CountsSchema,
    reachableCritical: z.literal(0),
    reachableHigh: z.literal(0),
    blockers: z.array(z.never()).length(0).readonly(),
    residuals: z.array(ResidualSchema).max(PRODUCTION_DEPENDENCY_AUDIT.MAX_RESIDUALS).readonly(),
  }).strict(),
}).strict()

export type ProductionDependencyAuditReceiptCandidate = z.infer<typeof ReceiptBaseSchema>

const PolicyBoundReceiptSchema = ReceiptBaseSchema.superRefine((receipt, context) => {
  for (const issue of productionDependencyAuditPolicyIssues(receipt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: [...issue.path] })
  }
})

export const ProductionDependencyAuditReceiptSchema = withDeepFrozenOutput(PolicyBoundReceiptSchema)
export type ProductionDependencyAuditReceipt = z.infer<typeof ProductionDependencyAuditReceiptSchema>

export function parseProductionDependencyAuditReceipt(input: unknown): ProductionDependencyAuditReceipt {
  return ProductionDependencyAuditReceiptSchema.parse(input)
}
