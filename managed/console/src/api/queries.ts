import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef } from "react"

import { ManagedApiError, MutationCertainty } from "./client.js"
import { clearPendingCreateKey, loadPendingCreateKey, savePendingCreateKey } from "./create-idempotency-key.js"
import { useMutationGate } from "./mutation-gate-context.js"
import { assertMutationAllowed } from "./mutation-gate.js"
import type { BrowserActionInput } from "./schema-integrations.js"
import { CreateIdempotencyKeySchema, type AdmissionId, type CreateIdempotencyKey, type SessionId } from "./schema-primitives.js"
import { useManagedApi } from "./context.js"

export const QueryKey = {
  ADMISSIONS: "admissions",
  CAPABILITIES: "capabilities",
  EVENTS: "events",
  POOL: "pool",
  SESSIONS: "sessions",
  TOOLS: "tools",
  VERSION: "version",
  WORKERS: "workers",
} as const

export const usePoolQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.pool(), queryKey: [QueryKey.POOL] })
}

export const useWorkersQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.workers(), queryKey: [QueryKey.WORKERS] })
}

export const useSessionsQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.sessions(), queryKey: [QueryKey.SESSIONS] })
}

export const useSessionQuery = (sessionId: SessionId | undefined) => {
  const api = useManagedApi()
  return useQuery({
    enabled: sessionId !== undefined,
    queryFn: () => sessionId === undefined ? Promise.reject(new TypeError("Session ID is required")) : api.session(sessionId),
    queryKey: [QueryKey.SESSIONS, sessionId],
  })
}

export const useAdmissionsQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.admissions(), queryKey: [QueryKey.ADMISSIONS] })
}

export const useEventsQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.events(), queryKey: [QueryKey.EVENTS] })
}

export const useVersionQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.version(), queryKey: [QueryKey.VERSION], staleTime: Number.POSITIVE_INFINITY })
}

export const useCapabilitiesQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.capabilities(), queryKey: [QueryKey.CAPABILITIES], staleTime: Number.POSITIVE_INFINITY })
}

export const useToolsQuery = () => {
  const api = useManagedApi()
  return useQuery({ queryFn: () => api.tools(), queryKey: [QueryKey.TOOLS], staleTime: Number.POSITIVE_INFINITY })
}

export function useReleaseSessionMutation(sessionId: SessionId) {
  const api = useManagedApi()
  const gate = useMutationGate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => { assertMutationAllowed(gate); return api.releaseSession(sessionId) },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QueryKey.POOL] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.SESSIONS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.WORKERS] }),
      ])
    },
  })
}

export function useCreateSessionMutation() {
  const api = useManagedApi()
  const gate = useMutationGate()
  const queryClient = useQueryClient()
  const key = useRef<CreateIdempotencyKey | undefined>(undefined)
  return useMutation({
    mutationFn: () => {
      assertMutationAllowed(gate)
      key.current ??= loadPendingCreateKey() ?? CreateIdempotencyKeySchema.parse(`console:${crypto.randomUUID()}`)
      savePendingCreateKey(key.current)
      return api.createSession(key.current)
    },
    onError: (error) => {
      if (error instanceof ManagedApiError && error.mutationCertainty === MutationCertainty.REJECTED) {
        clearPendingCreateKey()
        key.current = undefined
      }
    },
    onSuccess: () => {
      clearPendingCreateKey()
      key.current = undefined
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QueryKey.ADMISSIONS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.POOL] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.SESSIONS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.WORKERS] }),
      ])
    },
  })
}

export function useCancelAdmissionMutation(admissionId: AdmissionId) {
  const api = useManagedApi()
  const gate = useMutationGate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => { assertMutationAllowed(gate); return api.cancelAdmission(admissionId) },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QueryKey.ADMISSIONS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.POOL] }),
      ])
    },
  })
}

export function useBrowserActionMutation() {
  const api = useManagedApi()
  const gate = useMutationGate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BrowserActionInput) => { assertMutationAllowed(gate); return api.action(input) },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QueryKey.EVENTS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.SESSIONS] }),
      ])
    },
  })
}

export function useLiveViewMutation() {
  const api = useManagedApi()
  const gate = useMutationGate()
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (sessionId: SessionId) => { assertMutationAllowed(gate); return api.liveView(sessionId) }, onSettled: () => queryClient.invalidateQueries({ queryKey: [QueryKey.POOL] }) })
}
