import {
  AI_ASYNC_OUTCOME_STATE,
  AI_ROUTE_PATH,
  CONTROL_PLANE_API_VERSION,
  HTTP_RESPONSE_HEADER,
  MANAGED_ERROR_CODE,
  ResultIdSchema,
  createAiResultCompletedBodySchema,
  createToolResultSchemas,
  type AiResultPendingOutcome,
  type ControlPlaneConfig,
} from "@happycastle/steel-managed-shared"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { assertNever } from "../../domain/exhaustive.js"
import type { AiBrowserService } from "./action-service.js"
import type { ManagedRequestIdentity, ManagedRequestIdentityProvider, RequestContext } from "./execution-contract.js"
import type { AcceptedAction, CompletedAction } from "./service-contract.js"
import { COMPLETED_ACTION_KIND, RESULT_LOOKUP_KIND } from "./service-contract.js"
import { createToolPage } from "./tool-page.js"
import { createManagedAiContracts } from "./transport-config.js"
import {
  ManagedTransportError,
  requireJsonContentType,
  sendManagedError,
  translateFastifyError,
} from "./transport-error.js"

export type RestRouteDependencies = Readonly<{
  readonly service: AiBrowserService
  readonly requestIdentity: ManagedRequestIdentityProvider
  readonly config: ControlPlaneConfig
  readonly serviceVersion: string
}>

export function registerManagedRestRoutes(app: FastifyInstance, dependencies: RestRouteDependencies): void {
  app.get(AI_ROUTE_PATH.CAPABILITIES, async (request, reply) => {
    const identity = await dependencies.requestIdentity(request)
    try {
      const contracts = contractsFor(dependencies, identity)
      sendContextHeaders(reply, identity.context)
      return contracts.capabilities
    } catch (error) {
      return sendRouteError(reply, identity.context, error)
    }
  })

  app.get(AI_ROUTE_PATH.TOOLS, async (request, reply) => {
    const identity = await dependencies.requestIdentity(request)
    try {
      const contracts = contractsFor(dependencies, identity)
      sendContextHeaders(reply, identity.context)
      return await createToolPage(request.query, {
        selectedOrigin: identity.selectedOrigin,
        limits: contracts.limits,
      })
    } catch (error) {
      return sendRouteError(reply, identity.context, error)
    }
  })

  app.post(AI_ROUTE_PATH.ACTIONS, async (request, reply) => {
    const identity = await dependencies.requestIdentity(request)
    try {
      requireJsonContentType(request.headers["content-type"])
      const accepted = dependencies.service.submit({
        action: request.body,
        ...identity,
        signal: requestSignal(request),
      })
      sendAccepted(reply, accepted)
    } catch (error) {
      sendRouteError(reply, identity.context, error)
    }
  })

  app.get(AI_ROUTE_PATH.RESULT, async (request, reply) => {
    const identity = await dependencies.requestIdentity(request)
    try {
      const lookup = dependencies.service.result({
        resultId: parseResultId(request),
        ...identity,
      })
      switch (lookup.kind) {
        case RESULT_LOOKUP_KIND.PENDING:
          sendResultPending(reply, lookup.outcome)
          return
        case RESULT_LOOKUP_KIND.COMPLETED:
          sendCompleted(reply, lookup.value, identity, dependencies)
          return
        default:
          return assertNever(lookup)
      }
    } catch (error) {
      sendRouteError(reply, identity.context, error)
    }
  })
}

function contractsFor(dependencies: RestRouteDependencies, identity: ManagedRequestIdentity) {
  return createManagedAiContracts({
    config: dependencies.config,
    selectedOrigin: identity.selectedOrigin,
    serviceVersion: dependencies.serviceVersion,
  })
}

function sendAccepted(reply: FastifyReply, accepted: AcceptedAction): void {
  reply
    .header("location", accepted.headers[HTTP_RESPONSE_HEADER.LOCATION])
    .header("retry-after", accepted.headers[HTTP_RESPONSE_HEADER.RETRY_AFTER])
    .header("x-request-id", accepted.body.requestId)
    .header("x-correlation-id", accepted.body.correlationId)
    .code(accepted.status)
    .send(accepted.body)
}

export function sendResultPending(reply: FastifyReply, outcome: AiResultPendingOutcome): void {
  reply
    .header("retry-after", outcome.headers[HTTP_RESPONSE_HEADER.RETRY_AFTER])
    .header("x-request-id", outcome.body.requestId)
    .header("x-correlation-id", outcome.body.correlationId)
    .code(outcome.status)
    .send(outcome.body)
}

function sendCompleted(
  reply: FastifyReply,
  completed: CompletedAction,
  identity: ManagedRequestIdentity,
  dependencies: RestRouteDependencies,
): void {
  sendContextHeaders(reply, identity.context)
  switch (completed.kind) {
    case COMPLETED_ACTION_KIND.JSON:
      requireJsonResultAccept(reply.request.headers.accept)
      sendCompletedBody(reply, completed, identity, dependencies)
      return
    case COMPLETED_ACTION_KIND.BINARY:
      if (wantsBinary(reply.request.headers.accept, completed.contentType)) {
        reply
          .header("content-type", completed.contentType)
          .header("content-length", String(completed.bytes.byteLength))
          .send(Buffer.from(completed.bytes))
        return
      }
      requireJsonResultAccept(reply.request.headers.accept)
      sendCompletedBody(reply, completed, identity, dependencies)
      return
    default:
      return assertNever(completed)
  }
}

function sendCompletedBody(
  reply: FastifyReply,
  completed: CompletedAction,
  identity: ManagedRequestIdentity,
  dependencies: RestRouteDependencies,
): void {
  const limits = contractsFor(dependencies, identity).limits
  const resultSchema = createToolResultSchemas(identity.selectedOrigin, {
    httpBodyBytes: limits.httpBodyBytes,
    textBytes: limits.textBytes,
    binaryBytes: limits.binaryBytes,
    resultBytes: limits.resultBytes,
  }).ManagedToolResultSchema
  const body = createAiResultCompletedBodySchema(resultSchema).parse({
    apiVersion: CONTROL_PLANE_API_VERSION,
    resultId: completed.resultId,
    state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
    result: completed.output,
    requestId: identity.context.requestId,
    correlationId: identity.context.correlationId,
  })
  reply.code(200).send(body)
}

function parseResultId(request: FastifyRequest) {
  const parsed = z.object({ id: ResultIdSchema }).strict().safeParse(request.params)
  if (!parsed.success) throw new ManagedTransportError(MANAGED_ERROR_CODE.INVALID_ARGUMENT, "Result ID is invalid")
  return parsed.data.id
}

function requestSignal(request: FastifyRequest): AbortSignal {
  const controller = new AbortController()
  request.raw.once("aborted", () => controller.abort(new DOMException("HTTP request aborted", "AbortError")))
  return controller.signal
}

function sendContextHeaders(reply: FastifyReply, context: RequestContext): void {
  reply.header("x-request-id", context.requestId).header("x-correlation-id", context.correlationId)
}

function sendRouteError(reply: FastifyReply, context: RequestContext, error: unknown): void {
  sendManagedError(reply, context, error instanceof ManagedTransportError ? error : translateFastifyError(error))
}

function requireJsonResultAccept(accept: string | undefined): void {
  if (accept === undefined || mediaAccepted(accept, "application/json") || mediaAccepted(accept, "*/*")) return
  throw new ManagedTransportError(MANAGED_ERROR_CODE.NOT_ACCEPTABLE, "Accept must allow application/json")
}

function wantsBinary(accept: string | undefined, contentType: string): boolean {
  return accept !== undefined && mediaAccepted(accept, contentType) && !mediaAccepted(accept, "application/json") && !mediaAccepted(accept, "*/*")
}

function mediaAccepted(header: string, mediaType: string): boolean {
  return header.split(",").some((entry) => {
    const [name, ...parameters] = entry.trim().toLowerCase().split(";")
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="))
    return name === mediaType && (quality === undefined || Number(quality.trim().slice(2)) > 0)
  })
}
