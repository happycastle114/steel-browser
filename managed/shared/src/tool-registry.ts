import { z } from "zod"

import { ControlPlaneApiVersionSchema } from "./control-plane-contract.js"
import type { ManagedTransportConfig } from "./managed-transport-config.js"
import type { SelectedPublicOrigin } from "./public-urls.js"
import {
  TOOL_MUTABILITY,
  TOOL_OUTPUT_POLICY,
  TOOL_SESSION_REQUIREMENT,
  type ToolMutability,
  type ToolOutputPolicy,
  type ToolSessionRequirement,
} from "./control-plane-vocabulary.js"
import {
  AdmissionCancelToolInputSchema,
  AdmissionStatusToolInputSchema,
  ClickToolInputSchema,
  KeyToolInputSchema,
  LiveViewToolInputSchema,
  NavigateToolInputSchema,
  ScrapeToolInputSchema,
  ScreenshotToolInputSchema,
  SessionCreateToolInputSchema,
  SessionGetToolInputSchema,
  SessionListToolInputSchema,
  SessionReleaseToolInputSchema,
  SnapshotToolInputSchema,
  TypeToolInputSchema,
} from "./tool-input-schemas.js"
import {
  ActionAckSchema,
  AdmissionCancelToolOutputSchema,
  AdmissionStatusToolOutputSchema,
  NavigationResultSchema,
  SessionListToolOutputSchema,
  SessionReleaseToolOutputSchema,
  createToolResultSchemas,
} from "./tool-result-schemas.js"

export const TOOL_VERSION = "1.0.0" as const
export const TOOL_NAME = {
  SESSION_CREATE: "steel.session.create",
  SESSION_LIST: "steel.session.list",
  SESSION_GET: "steel.session.get",
  SESSION_RELEASE: "steel.session.release",
  ADMISSION_STATUS: "steel.admission.status",
  ADMISSION_CANCEL: "steel.admission.cancel",
  BROWSER_NAVIGATE: "steel.browser.navigate",
  BROWSER_SNAPSHOT: "steel.browser.snapshot",
  BROWSER_SCREENSHOT: "steel.browser.screenshot",
  BROWSER_SCRAPE: "steel.browser.scrape",
  BROWSER_CLICK: "steel.browser.click",
  BROWSER_TYPE: "steel.browser.type",
  BROWSER_KEY: "steel.browser.key",
  BROWSER_LIVE_VIEW: "steel.browser.live_view",
} as const
export const TOOL_NAMES = [
  TOOL_NAME.SESSION_CREATE,
  TOOL_NAME.SESSION_LIST,
  TOOL_NAME.SESSION_GET,
  TOOL_NAME.SESSION_RELEASE,
  TOOL_NAME.ADMISSION_STATUS,
  TOOL_NAME.ADMISSION_CANCEL,
  TOOL_NAME.BROWSER_NAVIGATE,
  TOOL_NAME.BROWSER_SNAPSHOT,
  TOOL_NAME.BROWSER_SCREENSHOT,
  TOOL_NAME.BROWSER_SCRAPE,
  TOOL_NAME.BROWSER_CLICK,
  TOOL_NAME.BROWSER_TYPE,
  TOOL_NAME.BROWSER_KEY,
  TOOL_NAME.BROWSER_LIVE_VIEW,
] as const
export type ToolName = (typeof TOOL_NAMES)[number]

type ToolDefinition<
  Name extends ToolName,
  InputOutput,
  InputDefinition extends z.ZodTypeDef,
  Input,
  Output,
  OutputDefinition extends z.ZodTypeDef,
  OutputInput,
> = Readonly<{
  readonly name: Name
  readonly version: typeof TOOL_VERSION
  readonly mutability: ToolMutability
  readonly sessionRequirement: ToolSessionRequirement
  readonly outputPolicy: ToolOutputPolicy
  readonly inputSchema: z.ZodType<InputOutput, InputDefinition, Input>
  readonly outputSchema: z.ZodType<Output, OutputDefinition, OutputInput>
}>

const definition = <
  const Name extends ToolName,
  InputOutput,
  InputDefinition extends z.ZodTypeDef,
  Input,
  Output,
  OutputDefinition extends z.ZodTypeDef,
  OutputInput,
>(input: Omit<ToolDefinition<
  Name,
  InputOutput,
  InputDefinition,
  Input,
  Output,
  OutputDefinition,
  OutputInput
>, "version">) => ({
  ...input,
  version: TOOL_VERSION,
} as const)

const READ = TOOL_MUTABILITY.READ
const WRITE = TOOL_MUTABILITY.WRITE
const NONE = TOOL_SESSION_REQUIREMENT.NONE
const EXPLICIT = TOOL_SESSION_REQUIREMENT.EXPLICIT
const STRUCTURED = TOOL_OUTPUT_POLICY.STRUCTURED

export function createToolDefinitionRegistry(
  originInput: SelectedPublicOrigin,
  transportInput: ManagedTransportConfig,
) {
  const output = createToolResultSchemas(originInput, transportInput)
  return Object.freeze({
  [TOOL_NAME.SESSION_CREATE]: definition({ name: TOOL_NAME.SESSION_CREATE, mutability: WRITE, sessionRequirement: NONE, outputPolicy: STRUCTURED, inputSchema: SessionCreateToolInputSchema, outputSchema: output.SessionCreateToolOutputSchema }),
  [TOOL_NAME.SESSION_LIST]: definition({ name: TOOL_NAME.SESSION_LIST, mutability: READ, sessionRequirement: NONE, outputPolicy: STRUCTURED, inputSchema: SessionListToolInputSchema, outputSchema: SessionListToolOutputSchema }),
  [TOOL_NAME.SESSION_GET]: definition({ name: TOOL_NAME.SESSION_GET, mutability: READ, sessionRequirement: EXPLICIT, outputPolicy: STRUCTURED, inputSchema: SessionGetToolInputSchema, outputSchema: output.SessionGetToolOutputSchema }),
  [TOOL_NAME.SESSION_RELEASE]: definition({ name: TOOL_NAME.SESSION_RELEASE, mutability: WRITE, sessionRequirement: EXPLICIT, outputPolicy: STRUCTURED, inputSchema: SessionReleaseToolInputSchema, outputSchema: SessionReleaseToolOutputSchema }),
  [TOOL_NAME.ADMISSION_STATUS]: definition({ name: TOOL_NAME.ADMISSION_STATUS, mutability: READ, sessionRequirement: NONE, outputPolicy: STRUCTURED, inputSchema: AdmissionStatusToolInputSchema, outputSchema: AdmissionStatusToolOutputSchema }),
  [TOOL_NAME.ADMISSION_CANCEL]: definition({ name: TOOL_NAME.ADMISSION_CANCEL, mutability: WRITE, sessionRequirement: NONE, outputPolicy: STRUCTURED, inputSchema: AdmissionCancelToolInputSchema, outputSchema: AdmissionCancelToolOutputSchema }),
  [TOOL_NAME.BROWSER_NAVIGATE]: definition({ name: TOOL_NAME.BROWSER_NAVIGATE, mutability: WRITE, sessionRequirement: EXPLICIT, outputPolicy: STRUCTURED, inputSchema: NavigateToolInputSchema, outputSchema: NavigationResultSchema }),
  [TOOL_NAME.BROWSER_SNAPSHOT]: definition({ name: TOOL_NAME.BROWSER_SNAPSHOT, mutability: READ, sessionRequirement: EXPLICIT, outputPolicy: TOOL_OUTPUT_POLICY.TEXT_BOUNDED, inputSchema: SnapshotToolInputSchema, outputSchema: output.SnapshotToolOutputSchema }),
  [TOOL_NAME.BROWSER_SCREENSHOT]: definition({ name: TOOL_NAME.BROWSER_SCREENSHOT, mutability: READ, sessionRequirement: EXPLICIT, outputPolicy: TOOL_OUTPUT_POLICY.BINARY_RETAINED, inputSchema: ScreenshotToolInputSchema, outputSchema: output.BinaryResultSchema }),
  [TOOL_NAME.BROWSER_SCRAPE]: definition({ name: TOOL_NAME.BROWSER_SCRAPE, mutability: READ, sessionRequirement: EXPLICIT, outputPolicy: TOOL_OUTPUT_POLICY.TEXT_BOUNDED, inputSchema: ScrapeToolInputSchema, outputSchema: output.ScrapeToolOutputSchema }),
  [TOOL_NAME.BROWSER_CLICK]: definition({ name: TOOL_NAME.BROWSER_CLICK, mutability: WRITE, sessionRequirement: EXPLICIT, outputPolicy: STRUCTURED, inputSchema: ClickToolInputSchema, outputSchema: ActionAckSchema }),
  [TOOL_NAME.BROWSER_TYPE]: definition({ name: TOOL_NAME.BROWSER_TYPE, mutability: WRITE, sessionRequirement: EXPLICIT, outputPolicy: STRUCTURED, inputSchema: TypeToolInputSchema, outputSchema: ActionAckSchema }),
  [TOOL_NAME.BROWSER_KEY]: definition({ name: TOOL_NAME.BROWSER_KEY, mutability: WRITE, sessionRequirement: EXPLICIT, outputPolicy: STRUCTURED, inputSchema: KeyToolInputSchema, outputSchema: ActionAckSchema }),
  [TOOL_NAME.BROWSER_LIVE_VIEW]: definition({ name: TOOL_NAME.BROWSER_LIVE_VIEW, mutability: READ, sessionRequirement: EXPLICIT, outputPolicy: TOOL_OUTPUT_POLICY.LIVE_INSTANCE_BOUND, inputSchema: LiveViewToolInputSchema, outputSchema: output.LiveViewResultSchema }),
  } as const satisfies Readonly<Record<ToolName, unknown>>)
}

const action = <
  const Name extends ToolName,
  InputOutput,
  InputDefinition extends z.ZodTypeDef,
  Input,
>(tool: Readonly<{
  readonly name: Name
  readonly version: typeof TOOL_VERSION
  readonly inputSchema: z.ZodType<InputOutput, InputDefinition, Input>
}>) => z
  .object({
    apiVersion: ControlPlaneApiVersionSchema,
    tool: z.object({ name: z.literal(tool.name), version: z.literal(tool.version) }).strict(),
    arguments: tool.inputSchema,
  })
  .strict()

export const AI_ACTION_REQUEST_SCHEMA = z.union([
  action({ name: TOOL_NAME.SESSION_CREATE, version: TOOL_VERSION, inputSchema: SessionCreateToolInputSchema }),
  action({ name: TOOL_NAME.SESSION_LIST, version: TOOL_VERSION, inputSchema: SessionListToolInputSchema }),
  action({ name: TOOL_NAME.SESSION_GET, version: TOOL_VERSION, inputSchema: SessionGetToolInputSchema }),
  action({ name: TOOL_NAME.SESSION_RELEASE, version: TOOL_VERSION, inputSchema: SessionReleaseToolInputSchema }),
  action({ name: TOOL_NAME.ADMISSION_STATUS, version: TOOL_VERSION, inputSchema: AdmissionStatusToolInputSchema }),
  action({ name: TOOL_NAME.ADMISSION_CANCEL, version: TOOL_VERSION, inputSchema: AdmissionCancelToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_NAVIGATE, version: TOOL_VERSION, inputSchema: NavigateToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_SNAPSHOT, version: TOOL_VERSION, inputSchema: SnapshotToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_SCREENSHOT, version: TOOL_VERSION, inputSchema: ScreenshotToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_SCRAPE, version: TOOL_VERSION, inputSchema: ScrapeToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_CLICK, version: TOOL_VERSION, inputSchema: ClickToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_TYPE, version: TOOL_VERSION, inputSchema: TypeToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_KEY, version: TOOL_VERSION, inputSchema: KeyToolInputSchema }),
  action({ name: TOOL_NAME.BROWSER_LIVE_VIEW, version: TOOL_VERSION, inputSchema: LiveViewToolInputSchema }),
])

export type AiActionRequest = z.infer<typeof AI_ACTION_REQUEST_SCHEMA>
