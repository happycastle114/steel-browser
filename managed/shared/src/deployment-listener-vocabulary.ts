export const MANAGED_LISTENER_ID = {
  MANAGER_PUBLIC_API: "MANAGER_PUBLIC_API",
  MANAGER_LOOPBACK_HEALTH: "MANAGER_LOOPBACK_HEALTH",
  WORKER_SUPERVISOR: "WORKER_SUPERVISOR",
  WORKER_LOOPBACK_UPSTREAM: "WORKER_LOOPBACK_UPSTREAM",
} as const

export const MANAGED_LISTENER_CONTAINER_ROLE = {
  MANAGER: "MANAGER",
  WORKER: "WORKER",
} as const

export const MANAGED_LISTENER_ROLE = {
  PUBLIC_API: "PUBLIC_API",
  HEALTH: "HEALTH",
  SUPERVISOR: "SUPERVISOR",
  UPSTREAM: "UPSTREAM",
} as const

export const MANAGED_LISTENER_BIND_SCOPE = {
  ALL_INTERFACES: "0.0.0.0",
  LOOPBACK: "127.0.0.1",
} as const

export const MANAGED_LISTENER_PUBLICATION = {
  TRAEFIK_PROXY_ONLY: "TRAEFIK_PROXY_ONLY",
  PRIVATE_PROJECT_ONLY: "PRIVATE_PROJECT_ONLY",
  UNPUBLISHED: "UNPUBLISHED",
} as const

export type ManagedListenerId = (typeof MANAGED_LISTENER_ID)[keyof typeof MANAGED_LISTENER_ID]
export type ManagedListenerContainerRole =
  (typeof MANAGED_LISTENER_CONTAINER_ROLE)[keyof typeof MANAGED_LISTENER_CONTAINER_ROLE]
export type ManagedListenerRole = (typeof MANAGED_LISTENER_ROLE)[keyof typeof MANAGED_LISTENER_ROLE]
export type ManagedListenerBindScope = (typeof MANAGED_LISTENER_BIND_SCOPE)[keyof typeof MANAGED_LISTENER_BIND_SCOPE]
export type ManagedListenerPublication =
  (typeof MANAGED_LISTENER_PUBLICATION)[keyof typeof MANAGED_LISTENER_PUBLICATION]

function enumMembers(vocabulary: Readonly<Record<string, string>>): readonly string[] {
  return Object.freeze(Object.values(vocabulary))
}

export const LISTENER_ENUM_VOCABULARY = {
  ManagedListenerId: enumMembers(MANAGED_LISTENER_ID),
  ManagedListenerContainerRole: enumMembers(MANAGED_LISTENER_CONTAINER_ROLE),
  ManagedListenerRole: enumMembers(MANAGED_LISTENER_ROLE),
  ManagedListenerBindScope: enumMembers(MANAGED_LISTENER_BIND_SCOPE),
  ManagedListenerPublication: enumMembers(MANAGED_LISTENER_PUBLICATION),
} as const satisfies Readonly<Record<string, readonly string[]>>
