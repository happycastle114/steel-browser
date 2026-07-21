import {
  AUTHORIZATION_OPERATION,
  EventListSchema,
} from "@happycastle/steel-managed-shared";
import { requireOperation } from "./authorization.js";
import {
  parseInput,
  parseOutput,
  parsePrincipal,
  sendManagedResponse,
} from "./boundary.js";
import { EventHttpQuerySchema } from "./query-schemas.js";
import type { ManagedRouteRegistrar } from "./routes-types.js";

export const registerManagedEventRoutes: ManagedRouteRegistrar = (
  app,
  options,
) => {
  app.get("/v1/managed/events", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.EVENTS_GLOBAL);
        const query = parseInput(EventHttpQuerySchema, request.query);
        const result = options.events.read({
          pageSize: query.pageSize,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.snapshotCursor === undefined
            ? {}
            : { snapshotCursor: query.snapshotCursor }),
        });
        return parseOutput(EventListSchema, result);
      },
    }),
  );
};
