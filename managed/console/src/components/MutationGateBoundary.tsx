import type { ReactNode } from "react"

import { ApiFailureKind, ManagedApiError } from "../api/client.js"
import { MutationGateProvider } from "../api/mutation-gate-context.js"
import { MutationGateState, type MutationGate } from "../api/mutation-gate.js"
import { usePoolQuery } from "../api/queries.js"
import { ManagerMode } from "../domain/vocabulary.js"
import { useOnlineStatus } from "../hooks/useOnlineStatus.js"

export function MutationGateBoundary({ children }: Readonly<{ readonly children: ReactNode }>) {
  const online = useOnlineStatus()
  const pool = usePoolQuery()
  return <MutationGateProvider value={resolveGate(online, pool)}>{children}</MutationGateProvider>
}

function resolveGate(online: boolean, pool: ReturnType<typeof usePoolQuery>): MutationGate {
  if (!online) return { allowed: false, state: MutationGateState.OFFLINE }
  if (pool.error instanceof ManagedApiError &&
    (pool.error.kind === ApiFailureKind.AUTHENTICATION || pool.error.kind === ApiFailureKind.FORBIDDEN)) {
    return { allowed: false, state: MutationGateState.AUTHENTICATION }
  }
  if (pool.isError || pool.isRefetchError || pool.data === undefined) {
    return { allowed: false, state: MutationGateState.UNAVAILABLE }
  }
  if (pool.isStale) return { allowed: false, state: MutationGateState.STALE }
  if (pool.data.mode === ManagerMode.DRAINING) return { allowed: false, state: MutationGateState.MANAGER_DRAINING }
  return { allowed: true, state: MutationGateState.READY }
}
