import { z } from "zod"

import { withDeepReadonlyOutput } from "./deep-readonly.js"
import {
  MANAGED_LISTENER_BIND_SCOPE,
  MANAGED_LISTENER_CONTAINER_ROLE,
  MANAGED_LISTENER_ID,
  MANAGED_LISTENER_PUBLICATION,
  MANAGED_LISTENER_ROLE,
} from "./deployment-listener-vocabulary.js"

export const MANAGED_ACTIVE_LISTENER_INVENTORY = [
  {
    id: MANAGED_LISTENER_ID.MANAGER_PUBLIC_API,
    containerRole: MANAGED_LISTENER_CONTAINER_ROLE.MANAGER,
    role: MANAGED_LISTENER_ROLE.PUBLIC_API,
    bindScope: MANAGED_LISTENER_BIND_SCOPE.ALL_INTERFACES,
    port: 3_000,
    publication: MANAGED_LISTENER_PUBLICATION.TRAEFIK_PROXY_ONLY,
  },
  {
    id: MANAGED_LISTENER_ID.MANAGER_LOOPBACK_HEALTH,
    containerRole: MANAGED_LISTENER_CONTAINER_ROLE.MANAGER,
    role: MANAGED_LISTENER_ROLE.HEALTH,
    bindScope: MANAGED_LISTENER_BIND_SCOPE.LOOPBACK,
    port: 3_001,
    publication: MANAGED_LISTENER_PUBLICATION.UNPUBLISHED,
  },
  {
    id: MANAGED_LISTENER_ID.WORKER_SUPERVISOR,
    containerRole: MANAGED_LISTENER_CONTAINER_ROLE.WORKER,
    role: MANAGED_LISTENER_ROLE.SUPERVISOR,
    bindScope: MANAGED_LISTENER_BIND_SCOPE.ALL_INTERFACES,
    port: 3_000,
    publication: MANAGED_LISTENER_PUBLICATION.PRIVATE_PROJECT_ONLY,
  },
  {
    id: MANAGED_LISTENER_ID.WORKER_LOOPBACK_UPSTREAM,
    containerRole: MANAGED_LISTENER_CONTAINER_ROLE.WORKER,
    role: MANAGED_LISTENER_ROLE.UPSTREAM,
    bindScope: MANAGED_LISTENER_BIND_SCOPE.LOOPBACK,
    port: 3_001,
    publication: MANAGED_LISTENER_PUBLICATION.UNPUBLISHED,
  },
] as const

export const STOPPED_MANAGED_LISTENER_INVENTORY = [] as const

export type ManagedListener = (typeof MANAGED_ACTIVE_LISTENER_INVENTORY)[number]

function exactManagedListenerSchema<const Listener extends ManagedListener>(listener: Listener) {
  return z
    .object({
      id: z.literal(listener.id),
      containerRole: z.literal(listener.containerRole),
      role: z.literal(listener.role),
      bindScope: z.literal(listener.bindScope),
      port: z.literal(listener.port),
      publication: z.literal(listener.publication),
    })
    .strict()
}

const ManagedActiveListenerInventoryBaseSchema = z.tuple([
  exactManagedListenerSchema(MANAGED_ACTIVE_LISTENER_INVENTORY[0]),
  exactManagedListenerSchema(MANAGED_ACTIVE_LISTENER_INVENTORY[1]),
  exactManagedListenerSchema(MANAGED_ACTIVE_LISTENER_INVENTORY[2]),
  exactManagedListenerSchema(MANAGED_ACTIVE_LISTENER_INVENTORY[3]),
])
export const ManagedActiveListenerInventorySchema = withDeepReadonlyOutput(ManagedActiveListenerInventoryBaseSchema)

const StoppedManagedListenerInventoryBaseSchema = z.tuple([])
export const StoppedManagedListenerInventorySchema = withDeepReadonlyOutput(StoppedManagedListenerInventoryBaseSchema)

export type ManagedActiveListenerInventory = z.infer<typeof ManagedActiveListenerInventorySchema>
export type StoppedManagedListenerInventory = z.infer<typeof StoppedManagedListenerInventorySchema>
