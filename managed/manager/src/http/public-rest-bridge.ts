import {
  PublicHttpMethod,
  PublicHttpMethodSchema,
  type PublicGatewayResponse,
  type PublicRestGateway,
} from "@happycastle/steel-managed-gateway"
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify"
import type { PrincipalId } from "@happycastle/steel-managed-shared"

const PUBLIC_METHODS = [
  PublicHttpMethod.DELETE,
  PublicHttpMethod.GET,
  PublicHttpMethod.HEAD,
  PublicHttpMethod.PATCH,
  PublicHttpMethod.POST,
  PublicHttpMethod.PUT,
] as const

type PublicRestBridgeOptions = Readonly<{
  gateway: Pick<PublicRestGateway, "handle">
  resolvePrincipal?: (request: FastifyRequest) => PrincipalId
}>

export function registerPublicRestBridge(
  app: FastifyInstance,
  options: PublicRestBridgeOptions,
): void {
  app.route({
    method: [...PUBLIC_METHODS],
    url: "/*",
    handler: async (request, reply) => {
      const body = requestBody(request)
      const response = await options.gateway.handle({
        ...(body === undefined ? {} : { body }),
        headers: normalizedHeaders(request),
        method: PublicHttpMethodSchema.parse(request.method),
        pathAndQuery: request.raw.url ?? request.url,
        ...(options.resolvePrincipal === undefined
          ? {}
          : { principalId: options.resolvePrincipal(request) }),
        requestId: request.id,
        signal: requestSignal(request),
      })
      return sendGatewayResponse(reply, response)
    },
  })
}

function requestBody(request: FastifyRequest): Buffer | undefined {
  if (request.body === undefined || request.body === null) return undefined
  if (Buffer.isBuffer(request.body)) return request.body
  if (typeof request.body === "string") return Buffer.from(request.body, "utf8")
  return Buffer.from(JSON.stringify(request.body), "utf8")
}

function normalizedHeaders(
  request: FastifyRequest,
): Readonly<Record<string, string | undefined>> {
  const headers: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[name] = value
  }
  return headers
}

function requestSignal(request: FastifyRequest): AbortSignal {
  const controller = new AbortController()
  request.raw.once("aborted", () => controller.abort())
  return controller.signal
}

function sendGatewayResponse(
  reply: FastifyReply,
  response: PublicGatewayResponse,
): FastifyReply {
  reply.code(response.statusCode)
  for (const [name, value] of Object.entries(response.headers)) {
    if (typeof value === "string") reply.header(name, value)
    else if (Array.isArray(value)) reply.header(name, [...value])
  }
  return reply.send(response.body)
}
