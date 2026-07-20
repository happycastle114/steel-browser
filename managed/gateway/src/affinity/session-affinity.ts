import {
  AmbiguousSessionAffinityError,
  NoLiveSessionError,
  SessionNotFoundError,
} from "../domain/errors.js"
import type { PublicSessionId } from "../domain/ids.js"

export type SessionAffinityHints = {
  readonly path?: PublicSessionId
  readonly header?: PublicSessionId
  readonly query?: PublicSessionId
}

export function resolveSessionAffinity(
  hints: SessionAffinityHints,
  liveSessions: readonly PublicSessionId[],
): PublicSessionId {
  const hinted = hints.path ?? hints.header ?? hints.query
  if (hinted !== undefined) {
    if (!liveSessions.includes(hinted)) throw new SessionNotFoundError(hinted)
    return hinted
  }
  const soleSession = liveSessions.at(0)
  if (liveSessions.length === 1 && soleSession !== undefined) return soleSession
  if (liveSessions.length > 1) throw new AmbiguousSessionAffinityError(liveSessions.length)
  throw new NoLiveSessionError()
}
