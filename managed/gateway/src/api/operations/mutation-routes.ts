import {
  AUTHORIZATION_OPERATION,
  ADMISSION_STATE,
  AdmissionSchema,
  EmptyManagedMutationBodySchema,
  MANAGED_ERROR_CODE,
  ManagedAdmissionCreateRequestSchema,
  PoolDrainRequestSchema,
  PoolResumeRequestSchema,
  PrincipalIdSchema,
  SessionSchema,
  SESSION_STATE,
  MANAGER_MODE,
} from "@happycastle/steel-managed-shared";
import {
  ownedResource,
  requireAuthorizedResource,
  requireOperation,
} from "./authorization.js";
import {
  parseInput,
  parseOutput,
  parsePrincipal,
  sendManagedResponse,
} from "./boundary.js";
import {
  AdmissionParamsSchema,
  SessionParamsSchema,
} from "./resource-routes.js";
import type { ManagedRouteRegistrar } from "./routes-types.js";
import { POOL_MUTATION_KIND } from "./pool-mutation-coordinator.js";
import {
  ManagedOperationsError,
  invalidManagedResourceIdentity,
} from "./errors.js";

export const registerManagedMutationRoutes: ManagedRouteRegistrar = (
  app,
  options,
) => {
  app.post("/v1/managed/admissions", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 202,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.SESSION_CREATE);
        const body = parseInput(
          ManagedAdmissionCreateRequestSchema,
          request.body,
        );
        return parseOutput(
          AdmissionSchema,
          await options.port.createAdmission({
            principalId: principal.principalId,
            request: body,
          }),
        );
      },
    }),
  );

  app.post("/v1/managed/admissions/:id/cancel", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.ADMISSION_CANCEL);
        const { id } = parseInput(AdmissionParamsSchema, request.params);
        const body = parseInput(EmptyManagedMutationBodySchema, request.body);
        const found = await options.port.findAdmission(id);
        const parsed =
          found === undefined
            ? undefined
            : ownedResource({
                ownerId: parseOutput(PrincipalIdSchema, found.ownerId),
                resource: parseOutput(AdmissionSchema, found.resource),
              });
        requireAuthorizedResource({
          code: MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND,
          operation: AUTHORIZATION_OPERATION.ADMISSION_CANCEL,
          principal,
          resource: parsed,
        });
        const admission = parseOutput(
          AdmissionSchema,
          await options.port.cancelAdmission({
            admissionId: id,
            body,
            principalId: principal.principalId,
          }),
        );
        if (admission.admissionId !== id)
          throw invalidManagedResourceIdentity();
        if (admission.state !== ADMISSION_STATE.CANCELLED)
          throw invalidMutationResult();
        return admission;
      },
    }),
  );

  app.post("/v1/managed/sessions/:id/release", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.SESSION_RELEASE);
        const { id } = parseInput(SessionParamsSchema, request.params);
        const body = parseInput(EmptyManagedMutationBodySchema, request.body);
        const found = await options.port.findSession(id);
        const parsed =
          found === undefined
            ? undefined
            : ownedResource({
                ownerId: parseOutput(PrincipalIdSchema, found.ownerId),
                resource: parseOutput(SessionSchema, found.resource),
              });
        requireAuthorizedResource({
          code: MANAGED_ERROR_CODE.SESSION_NOT_FOUND,
          operation: AUTHORIZATION_OPERATION.SESSION_RELEASE,
          principal,
          resource: parsed,
        });
        const session = parseOutput(
          SessionSchema,
          await options.port.releaseSession({
            body,
            principalId: principal.principalId,
            sessionId: id,
          }),
        );
        if (session.sessionId !== id) throw invalidManagedResourceIdentity();
        if (
          session.state !== SESSION_STATE.RELEASING &&
          session.state !== SESSION_STATE.RELEASED
        )
          throw invalidMutationResult();
        return session;
      },
    }),
  );

  app.post("/v1/managed/pool/drain", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.POOL_DRAIN);
        const body = parseInput(PoolDrainRequestSchema, request.body);
        const result = await options.poolMutations.execute({
          action: () =>
            options.port.drainPool({
              principalId: principal.principalId,
              request: body,
            }),
          idempotencyKey: body.idempotencyKey,
          kind: POOL_MUTATION_KIND.DRAIN,
          principalDigest: principal.principalDigest,
          request: body,
        });
        const pool = result;
        if (pool.managerInstanceId !== body.expectedManagerInstanceId)
          throw invalidManagedResourceIdentity();
        if (pool.mode !== MANAGER_MODE.DRAINING) throw invalidMutationResult();
        return pool;
      },
    }),
  );

  app.post("/v1/managed/pool/resume", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.POOL_RESUME);
        const body = parseInput(PoolResumeRequestSchema, request.body);
        const result = await options.poolMutations.execute({
          action: () =>
            options.port.resumePool({
              principalId: principal.principalId,
              request: body,
            }),
          idempotencyKey: body.idempotencyKey,
          kind: POOL_MUTATION_KIND.RESUME,
          principalDigest: principal.principalDigest,
          request: body,
        });
        const pool = result;
        if (pool.managerInstanceId !== body.expectedManagerInstanceId)
          throw invalidManagedResourceIdentity();
        if (pool.mode !== MANAGER_MODE.SERVING) throw invalidMutationResult();
        return pool;
      },
    }),
  );
};

function invalidMutationResult() {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
    message: "Managed mutation returned an invalid state",
  });
}
