import type { Uuid } from "@happycastle/steel-managed-shared";
import type { FastifyInstance } from "fastify";
import type { ManagedEventJournal } from "./event-journal.js";
import type { ManagedListSnapshotStore } from "./list-snapshot-store.js";
import type {
  ManagedOperationsPort,
  ManagedPrincipalResolver,
} from "./port.js";
import type { PoolMutationCoordinator } from "./pool-mutation-coordinator.js";

export type ManagedOperationsApiOptions = Readonly<{
  events: ManagedEventJournal;
  nextRequestId: () => Uuid;
  port: ManagedOperationsPort;
  poolMutations: PoolMutationCoordinator;
  resolvePrincipal: ManagedPrincipalResolver;
  snapshots: ManagedListSnapshotStore;
}>;

export type ManagedRouteRegistrar = (
  app: FastifyInstance,
  options: ManagedOperationsApiOptions,
) => void;
