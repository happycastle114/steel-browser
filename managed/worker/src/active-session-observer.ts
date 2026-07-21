import { get } from "node:http"
import { z } from "zod"
import {
  UPSTREAM_SESSION_STATUS,
  WORKER_ACTIVE_SESSION_TIMEOUT_MS,
  type UpstreamSessionStatus,
} from "./config.js"

const UPSTREAM_SESSION_OBSERVATION_MAX_BYTES = 1024 * 1024

export const ACTIVE_SESSION_OBSERVATION_KIND = {
  AVAILABLE: "AVAILABLE",
  UNAVAILABLE: "UNAVAILABLE",
} as const

const UpstreamSessionsSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          id: z.string().uuid(),
          status: z.enum([
            UPSTREAM_SESSION_STATUS.FAILED,
            UPSTREAM_SESSION_STATUS.IDLE,
            UPSTREAM_SESSION_STATUS.LIVE,
            UPSTREAM_SESSION_STATUS.RELEASED,
          ]),
        })
        .passthrough(),
    ),
  })
  .passthrough()

export type ActiveSessionObservation =
  | {
      readonly kind: typeof ACTIVE_SESSION_OBSERVATION_KIND.AVAILABLE
      readonly session: {
        readonly id: string
        readonly status: UpstreamSessionStatus
      } | null
    }
  | { readonly kind: typeof ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE }

export type UpstreamObservationTarget = {
  readonly address: string
  readonly port: number
  readonly timeoutMs?: number
}

function reduceSessions(input: unknown): ActiveSessionObservation {
  const parsed = UpstreamSessionsSchema.safeParse(input)
  if (!parsed.success) {
    return { kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE }
  }
  const [currentSession, ...pastSessions] = parsed.data.sessions
  if (
    currentSession === undefined ||
    currentSession.status === UPSTREAM_SESSION_STATUS.FAILED ||
    pastSessions.some(
      (session) =>
        session.status === UPSTREAM_SESSION_STATUS.IDLE ||
        session.status === UPSTREAM_SESSION_STATUS.LIVE,
    )
  ) {
    return { kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE }
  }
  if (currentSession.status !== UPSTREAM_SESSION_STATUS.LIVE) {
    return { kind: ACTIVE_SESSION_OBSERVATION_KIND.AVAILABLE, session: null }
  }
  return {
    kind: ACTIVE_SESSION_OBSERVATION_KIND.AVAILABLE,
    session: {
      id: currentSession.id,
      status: currentSession.status,
    },
  }
}

export function observeActiveSession(
  target: UpstreamObservationTarget,
): Promise<ActiveSessionObservation> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (observation: ActiveSessionObservation): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(observation)
    }
    const outgoing = get(
      {
        host: target.address,
        path: "/v1/sessions",
        port: target.port,
      },
      (response) => {
        response.on("aborted", () =>
          finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE }),
        )
        response.on("error", () =>
          finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE }),
        )
        response.on("close", () => {
          if (!response.complete) {
            finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE })
          }
        })
        if (response.statusCode !== 200) {
          response.resume()
          finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE })
          return
        }
        const chunks: Buffer[] = []
        let byteLength = 0
        response.on("data", (chunk: Buffer) => {
          byteLength += chunk.byteLength
          if (byteLength > UPSTREAM_SESSION_OBSERVATION_MAX_BYTES) {
            response.destroy()
            finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE })
            return
          }
          chunks.push(chunk)
        })
        response.on("end", () => {
          if (settled) {
            return
          }
          try {
            finish(reduceSessions(JSON.parse(Buffer.concat(chunks).toString("utf8"))))
          } catch (error) {
            if (error instanceof SyntaxError) {
              finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE })
              return
            }
            throw error
          }
        })
      },
    )
    outgoing.setTimeout(
      target.timeoutMs ?? WORKER_ACTIVE_SESSION_TIMEOUT_MS,
      () => {
        finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE })
        outgoing.destroy()
      },
    )
    outgoing.on("error", () =>
      finish({ kind: ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE }),
    )
  })
}
