import { z } from "zod"
import type { PublicSessionId } from "../../domain/ids.js"
import type { WorkerDescriptor } from "../../registry/registry-model.js"
import type { WorkerRestProxy } from "./proxy.js"
import {
  PublicHttpMethod,
  PublicRouteId,
  type PublicHttpResponse,
} from "./schemas.js"
import { PublicResponseRewriteError, rewritePublicResponse } from "./url-rewriter.js"

const SessionListSchema = z.object({
  sessions: z.array(z.object({ id: z.string().uuid() }).passthrough()),
}).passthrough()

type SessionListAggregationInput = {
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly method: PublicHttpMethod
  readonly pathAndQuery: string
  readonly proxy: WorkerRestProxy
  readonly publicOrigin: string
  readonly signal: AbortSignal
  readonly workers: readonly SessionListWorker[]
}

export type SessionListWorker = {
  readonly expectedSessionId?: PublicSessionId
  readonly worker: WorkerDescriptor
}

type WorkerResult =
  | { readonly ok: true; readonly response: PublicHttpResponse }
  | { readonly error: unknown; readonly ok: false }

export async function aggregateSessionLists(
  input: SessionListAggregationInput,
): Promise<PublicHttpResponse> {
  const results = await Promise.all(input.workers.map(async (target): Promise<WorkerResult> => {
    try {
      const upstream = await input.proxy.send({
        headers: input.headers,
        method: input.method,
        pathAndQuery: input.pathAndQuery,
        signal: input.signal,
        worker: target.worker,
      })
      return {
        ok: true,
        response: rewritePublicResponse({
          publicOrigin: input.publicOrigin,
          requestMethod: input.method,
          routeId: PublicRouteId.SESSIONS_LIST,
          upstreamOrigin: target.worker.origin,
          response: upstream,
        }),
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error("unknown worker list failure"),
        ok: false,
      }
    }
  }))
  const failure = results.find((result) => !result.ok)
  if (failure !== undefined && !failure.ok) throw failure.error
  const responses = results.flatMap((result) => result.ok ? [result.response] : [])
  const upstreamError = responses.find(({ statusCode }) => statusCode < 200 || statusCode >= 300)
  if (upstreamError !== undefined) return upstreamError
  const first = responses[0]
  if (first === undefined) throw new PublicResponseRewriteError("session list had no worker response")
  if (input.method === PublicHttpMethod.HEAD) {
    return { ...first, headers: withoutContentLength(first.headers), body: Buffer.alloc(0) }
  }
  try {
    const bodies = responses.map(({ body }) => SessionListSchema.parse(
      JSON.parse(body.toString("utf8")),
    ))
    bodies.forEach((body, index) => assertWorkerOwnership(body.sessions, input.workers[index]))
    const sessions = bodies.flatMap(({ sessions }) => sessions)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (new Set(sessions.map(({ id }) => id)).size !== sessions.length) {
      throw new TypeError("duplicate public session ID")
    }
    const body = Buffer.from(JSON.stringify({ ...bodies[0], sessions }))
    return {
      statusCode: first.statusCode,
      headers: { ...first.headers, "content-length": String(body.byteLength) },
      body,
    }
  } catch (error) {
    throw new PublicResponseRewriteError(
      "worker session list did not match the public contract",
      error instanceof Error ? { cause: error } : undefined,
    )
  }
}

function assertWorkerOwnership(
  sessions: readonly { readonly id: string }[],
  target: SessionListWorker | undefined,
): void {
  if (target === undefined) throw new TypeError("missing session owner")
  if (target.expectedSessionId === undefined) {
    if (sessions.length !== 0) throw new TypeError("worker returned an unowned session")
    return
  }
  if (sessions.length !== 1 || sessions[0]?.id !== target.expectedSessionId) {
    throw new TypeError("worker returned a session owned by another generation")
  }
}

function withoutContentLength(
  headers: PublicHttpResponse["headers"],
): PublicHttpResponse["headers"] {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-length"),
  )
}
