import { z } from "zod"

import {
  GitCommitShaSchema,
  InstanceIdSchema,
  IsoTimeSchema,
  OciDigestSchema,
  SafeCountSchema,
  SessionIdSchema,
  Sha256Schema,
  WorkerIdSchema,
} from "./control-plane-primitives.js"
import { CREATE_JOURNAL_STATE, WORKER_STATE } from "./control-plane-vocabulary.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"

export const COOLIFY_BROWSER_READBACK_CONTRACT = {
  SCHEMA_VERSION: 1,
  ENVIRONMENT: "COOLIFY",
  STATUS: "VERIFIED",
  UID: 10_001,
  GID: 10_001,
  BROWSER_PROCESS_SECCOMP_MODE: 2,
  BROWSER_EXECUTABLE: "/usr/bin/chromium",
  VERSION_COMMAND: "/usr/bin/chromium --version",
  CDP_COMMAND: "Browser.getVersion",
  BROWSER_ARGUMENT: {
    HEADLESS: "--headless=new",
    EPHEMERAL_CDP: "--remote-debugging-port=0",
    CDP_PORT_PREFIX: "--remote-debugging-port=",
    NO_SANDBOX: "--no-sandbox",
    DISABLE_SETUID_SANDBOX: "--disable-setuid-sandbox",
    DISABLE_NAMESPACE_SANDBOX: "--disable-namespace-sandbox",
  },
  NETWORK: {
    SUPERVISOR_PORT: 3_000,
    UPSTREAM_HOST: "127.0.0.1",
    UPSTREAM_PORT: 3_001,
    CDP_TRANSPORT: "EPHEMERAL_LOOPBACK",
  },
  RESOURCE: {
    MEMORY_CURRENT_MAX_BYTES: 671_088_640,
    MEMORY_LIMIT_BYTES: 2_684_354_560,
    MEMORY_RESERVATION_BYTES: 1_342_177_280,
    RUN_MAX_BYTES: 67_108_864,
    TMP_MAX_BYTES: 268_435_456,
    PROFILE_MAX_BYTES: 268_435_456,
    SHM_MAX_BYTES: 536_870_912,
    WRITABLE_BYTES: 1_140_850_688,
    BASE_BYTES: 671_088_640,
    AGGREGATE_BYTES: 1_811_939_328,
    MAX_BUDGET_BYTES: 2_147_483_648,
    SLACK_BYTES: 335_544_320,
    MAX_UTILIZATION_NUMERATOR: 4,
    MAX_UTILIZATION_DENOMINATOR: 5,
  },
  ROUTE: {
    CANDIDATE: {
      PHASE: "CANDIDATE_QUALIFICATION",
      HOST: "steel-candidate.soungmin.tech",
      PUBLIC_ORIGIN: "https://steel-candidate.soungmin.tech",
      LEGACY_PRODUCTION_OWNER_RUNNING: true,
    },
    PRODUCTION: {
      PHASE: "PRODUCTION_REPROOF",
      HOST: "steel.soungmin.tech",
      PUBLIC_ORIGIN: "https://steel.soungmin.tech",
      LEGACY_PRODUCTION_OWNER_RUNNING: false,
    },
  },
} as const

const IMAGE_REFERENCE_PATTERN =
  /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/u
const BROWSER_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){3}$/u
const CDP_PRODUCT_PATTERN = /^(?:Chrome|Chromium)\/[0-9]+(?:\.[0-9]+){3}$/u
const DBUS_ADDRESS_PATTERN = /^unix:path=\/run\/steel\/runtime\/[A-Za-z0-9._-]+(?:,guid=[0-9a-f]{32})?$/u

export const DigestPinnedImageReferenceSchema = z
  .string()
  .regex(IMAGE_REFERENCE_PATTERN)
  .brand("DigestPinnedImageReference")

const ImageSchema = z.object({
  candidate: DigestPinnedImageReferenceSchema,
  containerImageId: OciDigestSchema,
  inspectedImageId: OciDigestSchema,
  repoDigests: z.array(DigestPinnedImageReferenceSchema).min(1).max(32),
  containerId: z.string().regex(/^[a-f0-9]{12,64}$/u),
  containerStartedAt: IsoTimeSchema,
}).strict()

const IdentitySchema = z.object({
  workerId: WorkerIdSchema,
  instanceId: InstanceIdSchema,
}).strict()

const SourceSchema = z.object({
  revision: GitCommitShaSchema,
  manifestSha256: Sha256Schema,
  manifestVerified: z.literal(true),
  manifestFileCount: SafeCountSchema.refine((count) => count > 0),
}).strict()

const SecuritySchema = z.object({
  uid: z.literal(COOLIFY_BROWSER_READBACK_CONTRACT.UID),
  gid: z.literal(COOLIFY_BROWSER_READBACK_CONTRACT.GID),
  readOnlyRootFileSystem: z.literal(true),
  noNewPrivileges: z.literal(true),
  privileged: z.literal(false),
  capabilities: z.array(z.never()).length(0),
  browserProcessNoNewPrivileges: z.literal(true),
  browserProcessSeccompMode: z.literal(COOLIFY_BROWSER_READBACK_CONTRACT.BROWSER_PROCESS_SECCOMP_MODE),
}).strict()

const resource = COOLIFY_BROWSER_READBACK_CONTRACT.RESOURCE
const ResourceSchema = z.object({
  memoryCurrentBytes: z.number().int().safe().nonnegative().max(resource.MEMORY_CURRENT_MAX_BYTES),
  memoryLimitBytes: z.literal(resource.MEMORY_LIMIT_BYTES),
  memoryReservationBytes: z.literal(resource.MEMORY_RESERVATION_BYTES),
  runMaxBytes: z.literal(resource.RUN_MAX_BYTES),
  tmpMaxBytes: z.literal(resource.TMP_MAX_BYTES),
  profileMaxBytes: z.literal(resource.PROFILE_MAX_BYTES),
  shmMaxBytes: z.literal(resource.SHM_MAX_BYTES),
}).strict()

const network = COOLIFY_BROWSER_READBACK_CONTRACT.NETWORK
const NetworkSchema = z.object({
  supervisorPort: z.literal(network.SUPERVISOR_PORT),
  upstreamHost: z.literal(network.UPSTREAM_HOST),
  upstreamPort: z.literal(network.UPSTREAM_PORT),
  cdpTransport: z.literal(network.CDP_TRANSPORT),
  exposedContainerPorts: z.tuple([z.literal(network.SUPERVISOR_PORT)]),
  publishedHostPorts: z.array(z.never()).length(0),
}).strict()

const contract = COOLIFY_BROWSER_READBACK_CONTRACT
const BrowserSchema = z.object({
  executable: z.literal(contract.BROWSER_EXECUTABLE),
  versionCommand: z.literal(contract.VERSION_COMMAND),
  versionOutput: z.string().min(1).max(512),
  version: z.string().regex(BROWSER_VERSION_PATTERN),
  arguments: z.array(z.string().min(1)).min(2).max(64),
  dbusAddress: z.string().regex(DBUS_ADDRESS_PATTERN),
  headless: z.literal(true),
  xvfbProcessCount: z.literal(0),
  sandboxEnabled: z.literal(true),
  cdpCommand: z.literal(contract.CDP_COMMAND),
  cdpProduct: z.string().regex(CDP_PRODUCT_PATTERN),
  cdpProtocolVersion: z.string().regex(/^[0-9]+\.[0-9]+$/u),
}).strict()

const LifecycleSchema = z.object({
  created: z.object({ sessionId: SessionIdSchema, journalState: z.literal(CREATE_JOURNAL_STATE.LIVE), at: IsoTimeSchema }).strict(),
  cdpObserved: z.object({ sessionId: SessionIdSchema, command: z.literal(contract.CDP_COMMAND), at: IsoTimeSchema }).strict(),
  released: z.object({ sessionId: SessionIdSchema, journalState: z.literal(CREATE_JOURNAL_STATE.RELEASED_TERMINAL), at: IsoTimeSchema }).strict(),
  idle: z.object({ workerId: WorkerIdSchema, instanceId: InstanceIdSchema, state: z.literal(WORKER_STATE.IDLE), activeSessionId: z.null(), at: IsoTimeSchema }).strict(),
}).strict()

const route = contract.ROUTE
const RouteSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal(route.CANDIDATE.PHASE), host: z.literal(route.CANDIDATE.HOST), publicOrigin: z.literal(route.CANDIDATE.PUBLIC_ORIGIN), legacyProductionOwnerRunning: z.literal(route.CANDIDATE.LEGACY_PRODUCTION_OWNER_RUNNING) }).strict(),
  z.object({ phase: z.literal(route.PRODUCTION.PHASE), host: z.literal(route.PRODUCTION.HOST), publicOrigin: z.literal(route.PRODUCTION.PUBLIC_ORIGIN), legacyProductionOwnerRunning: z.literal(route.PRODUCTION.LEGACY_PRODUCTION_OWNER_RUNNING) }).strict(),
])

const ReceiptBaseSchema = z.object({
  schemaVersion: z.literal(contract.SCHEMA_VERSION),
  image: ImageSchema,
  identity: IdentitySchema,
  source: SourceSchema,
  security: SecuritySchema,
  resources: ResourceSchema,
  network: NetworkSchema,
  browser: BrowserSchema,
  lifecycle: LifecycleSchema,
  route: RouteSchema,
  evidence: z.object({ environment: z.literal(contract.ENVIRONMENT), status: z.literal(contract.STATUS), capturedAt: IsoTimeSchema }).strict(),
}).strict().superRefine((receipt, context) => {
  const exactOutput = `Chromium ${receipt.browser.version}`
  const forbidden = [
    contract.BROWSER_ARGUMENT.NO_SANDBOX,
    contract.BROWSER_ARGUMENT.DISABLE_NAMESPACE_SANDBOX,
  ]
  const cdpPortArguments = receipt.browser.arguments.filter((argument) => argument.startsWith(contract.BROWSER_ARGUMENT.CDP_PORT_PREFIX))
  const session = receipt.lifecycle.created.sessionId
  const writableBytes = receipt.resources.runMaxBytes + receipt.resources.tmpMaxBytes + receipt.resources.profileMaxBytes + receipt.resources.shmMaxBytes
  const aggregateBytes = resource.BASE_BYTES + writableBytes
  const maxBudgetBytes = Math.floor(receipt.resources.memoryLimitBytes * resource.MAX_UTILIZATION_NUMERATOR / resource.MAX_UTILIZATION_DENOMINATOR)
  const slackBytes = maxBudgetBytes - aggregateBytes
  const timelineIsOrdered =
    Date.parse(receipt.image.containerStartedAt) < Date.parse(receipt.lifecycle.created.at) &&
    Date.parse(receipt.lifecycle.created.at) < Date.parse(receipt.lifecycle.cdpObserved.at) &&
    Date.parse(receipt.lifecycle.cdpObserved.at) < Date.parse(receipt.lifecycle.released.at) &&
    Date.parse(receipt.lifecycle.released.at) < Date.parse(receipt.lifecycle.idle.at) &&
    Date.parse(receipt.lifecycle.idle.at) < Date.parse(receipt.evidence.capturedAt)
  if (receipt.image.containerImageId !== receipt.image.inspectedImageId || !receipt.image.repoDigests.includes(receipt.image.candidate) || new Set(receipt.image.repoDigests).size !== receipt.image.repoDigests.length)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "image identity proof is inconsistent", path: ["image"] })
  if (writableBytes !== resource.WRITABLE_BYTES || aggregateBytes !== resource.AGGREGATE_BYTES || maxBudgetBytes !== resource.MAX_BUDGET_BYTES || aggregateBytes > maxBudgetBytes || slackBytes !== resource.SLACK_BYTES)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "resource arithmetic proof is inconsistent", path: ["resources"] })
  if (receipt.browser.versionOutput !== exactOutput && !receipt.browser.versionOutput.startsWith(`${exactOutput} `))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "browser output does not bind the version", path: ["browser", "versionOutput"] })
  if (receipt.browser.cdpProduct.slice(receipt.browser.cdpProduct.indexOf("/") + 1) !== receipt.browser.version)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "CDP product does not bind the version", path: ["browser", "cdpProduct"] })
  if (!receipt.browser.arguments.includes(contract.BROWSER_ARGUMENT.HEADLESS) || !receipt.browser.arguments.includes(contract.BROWSER_ARGUMENT.DISABLE_SETUID_SANDBOX) || cdpPortArguments.length !== 1 || !cdpPortArguments.includes(contract.BROWSER_ARGUMENT.EPHEMERAL_CDP) || forbidden.some((argument) => receipt.browser.arguments.some((actual) => actual === argument || actual.startsWith(`${argument}=`))))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "browser arguments do not prove sandboxed ephemeral CDP", path: ["browser", "arguments"] })
  if (receipt.lifecycle.cdpObserved.sessionId !== session || receipt.lifecycle.released.sessionId !== session || receipt.lifecycle.idle.workerId !== receipt.identity.workerId || receipt.lifecycle.idle.instanceId !== receipt.identity.instanceId)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "lifecycle identity proof is inconsistent", path: ["lifecycle"] })
  if (!timelineIsOrdered)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "lifecycle evidence is not strictly ordered", path: ["lifecycle"] })
})

export const CoolifyBrowserReadbackReceiptSchema = withDeepFrozenOutput(ReceiptBaseSchema)
export type DigestPinnedImageReference = z.infer<typeof DigestPinnedImageReferenceSchema>
export type CoolifyBrowserReadbackReceipt = z.infer<typeof CoolifyBrowserReadbackReceiptSchema>

export function parseCoolifyBrowserReadbackReceipt(input: unknown): CoolifyBrowserReadbackReceipt {
  return CoolifyBrowserReadbackReceiptSchema.parse(input)
}
