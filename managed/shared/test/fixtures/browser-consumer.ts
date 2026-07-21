import {
  AI_ACTION_REQUEST_SCHEMA,
  AiActionAcceptedBodySchema,
  AiResultPendingBodySchema,
  CapabilityLimitsSchema,
  MANAGED_RELEASE_EVIDENCE_MODE,
  ResultIdSchema,
  SessionIdSchema,
  StructuralCapabilitiesSchema,
  StructuralToolsResponseSchema,
  TOOL_NAME,
  createAiActionAcceptedOutcomeSchema,
  createAiResultBodySchema,
  createAiResultCompletedBodySchema,
  createAiResultCompletedOutcomeSchema,
  createAiResultOutcomeSchema,
  createAiToolPageContract,
  createAiToolPageSchema,
  createPublicUrlSchemas,
  createToolResultSchemas,
  deriveManagedTransportConfig,
  selectConfiguredPublicOrigin,
} from "@happycastle/steel-managed-shared/browser"
import type {
  AiActionAcceptedBody,
  AiActionRequest,
  AiResultCompletedBody,
  AiResultCompletedOutcome,
  AiResultOutcome,
  AiResultPendingBody,
  AiToolPage,
  LiveViewResult,
  ResultId,
  SelectedPublicOrigin,
  SessionId,
  StructuralCapabilities,
  StructuralToolsResponse,
} from "@happycastle/steel-managed-shared/browser"

export const BROWSER_SCHEMAS = {
  AI_ACTION_REQUEST_SCHEMA,
  AiActionAcceptedBodySchema,
  AiResultPendingBodySchema,
  CapabilityLimitsSchema,
  MANAGED_RELEASE_EVIDENCE_MODE,
  ResultIdSchema,
  SessionIdSchema,
  StructuralCapabilitiesSchema,
  StructuralToolsResponseSchema,
  TOOL_NAME,
} as const

export const BROWSER_FACTORIES = {
  createAiActionAcceptedOutcomeSchema,
  createAiResultBodySchema,
  createAiResultCompletedBodySchema,
  createAiResultCompletedOutcomeSchema,
  createAiResultOutcomeSchema,
  createAiToolPageContract,
  createAiToolPageSchema,
  createPublicUrlSchemas,
  createToolResultSchemas,
  deriveManagedTransportConfig,
  selectConfiguredPublicOrigin,
} as const

export type BrowserConsumerTypes = Readonly<{
  readonly action: AiActionRequest
  readonly toolPage: AiToolPage
  readonly acceptedBody: AiActionAcceptedBody
  readonly pendingBody: AiResultPendingBody
  readonly completedBody: AiResultCompletedBody<LiveViewResult>
  readonly completed: AiResultCompletedOutcome<LiveViewResult>
  readonly outcome: AiResultOutcome<LiveViewResult>
  readonly capabilities: StructuralCapabilities
  readonly tools: StructuralToolsResponse
  readonly origin: SelectedPublicOrigin
  readonly resultId: ResultId
  readonly sessionId: SessionId
}>
