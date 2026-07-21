import {
  AUTHORIZATION_OPERATION,
  AdmissionListSchema,
  AdmissionSchema,
  LIST_RESOURCE_KIND,
  PrincipalIdSchema,
  SessionListSchema,
  SessionSchema,
  WorkerListSchema,
  WorkerSchema,
} from "@happycastle/steel-managed-shared";
import {
  authorizedResources,
  ownedResource,
  requireOperation,
} from "./authorization.js";
import {
  parseInput,
  parseOutput,
  parsePrincipal,
  sendManagedResponse,
} from "./boundary.js";
import {
  MANAGED_DEFAULT_PAGE_SIZE,
  QueueHttpQuerySchema,
  SessionHttpQuerySchema,
  WorkerHttpQuerySchema,
} from "./query-schemas.js";
import type { ManagedRouteRegistrar } from "./routes-types.js";

export const registerManagedListRoutes: ManagedRouteRegistrar = (
  app,
  options,
) => {
  app.get("/v1/managed/workers", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.WORKER_INVENTORY);
        const query = parseInput(WorkerHttpQuerySchema, request.query);
        const result =
          query.cursor === undefined
            ? options.snapshots.create({
                kind: LIST_RESOURCE_KIND.WORKERS,
                items: (await options.port.captureWorkers()).map((item) =>
                  parseOutput(WorkerSchema, item),
                ),
                pageSize: query.pageSize ?? MANAGED_DEFAULT_PAGE_SIZE,
                principalDigest: principal.principalDigest,
                states: query.state ?? [],
              })
            : options.snapshots.continue({
                kind: LIST_RESOURCE_KIND.WORKERS,
                cursor: query.cursor,
                principalDigest: principal.principalDigest,
                ...(query.pageSize === undefined
                  ? {}
                  : { pageSize: query.pageSize }),
                ...(query.state === undefined ? {} : { states: query.state }),
              });
        return parseOutput(WorkerListSchema, result.value);
      },
    }),
  );

  app.get("/v1/managed/sessions", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.SESSION_LIST);
        const query = parseInput(SessionHttpQuerySchema, request.query);
        const result =
          query.cursor === undefined
            ? options.snapshots.create({
                kind: LIST_RESOURCE_KIND.SESSIONS,
                items: authorizedResources({
                  operation: AUTHORIZATION_OPERATION.SESSION_LIST,
                  principal,
                  resources: (await options.port.captureSessions()).map(
                    ({ ownerId, resource }) =>
                      ownedResource({
                        ownerId: parseOutput(PrincipalIdSchema, ownerId),
                        resource: parseOutput(SessionSchema, resource),
                      }),
                  ),
                }),
                pageSize: query.pageSize ?? MANAGED_DEFAULT_PAGE_SIZE,
                principalDigest: principal.principalDigest,
                states: query.state ?? [],
              })
            : options.snapshots.continue({
                kind: LIST_RESOURCE_KIND.SESSIONS,
                cursor: query.cursor,
                principalDigest: principal.principalDigest,
                ...(query.pageSize === undefined
                  ? {}
                  : { pageSize: query.pageSize }),
                ...(query.state === undefined ? {} : { states: query.state }),
              });
        return parseOutput(SessionListSchema, result.value);
      },
    }),
  );

  app.get("/v1/managed/queue", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.QUEUE_GLOBAL);
        const query = parseInput(QueueHttpQuerySchema, request.query);
        const result =
          query.cursor === undefined
            ? options.snapshots.create({
                kind: LIST_RESOURCE_KIND.QUEUE,
                items: (await options.port.captureQueue()).map((item) =>
                  parseOutput(AdmissionSchema, item),
                ),
                pageSize: query.pageSize ?? MANAGED_DEFAULT_PAGE_SIZE,
                principalDigest: principal.principalDigest,
                states: query.state ?? [],
              })
            : options.snapshots.continue({
                kind: LIST_RESOURCE_KIND.QUEUE,
                cursor: query.cursor,
                principalDigest: principal.principalDigest,
                ...(query.pageSize === undefined
                  ? {}
                  : { pageSize: query.pageSize }),
                ...(query.state === undefined ? {} : { states: query.state }),
              });
        return parseOutput(AdmissionListSchema, result.value);
      },
    }),
  );
};
