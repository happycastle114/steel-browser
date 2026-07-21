import type { FastifyInstance } from "fastify";
import { registerManagedEventRoutes } from "./event-routes.js";
import { registerManagedListRoutes } from "./list-routes.js";
import { registerManagedMutationRoutes } from "./mutation-routes.js";
import { registerManagedResourceRoutes } from "./resource-routes.js";
import type { ManagedOperationsApiOptions } from "./routes-types.js";

export async function registerManagedOperationsApi(
  app: FastifyInstance,
  options: ManagedOperationsApiOptions,
): Promise<void> {
  registerManagedResourceRoutes(app, options);
  registerManagedListRoutes(app, options);
  registerManagedEventRoutes(app, options);
  registerManagedMutationRoutes(app, options);
}
