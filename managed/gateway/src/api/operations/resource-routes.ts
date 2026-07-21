import {
  AUTHORIZATION_OPERATION,
  AdmissionIdSchema,
  AdmissionSchema,
  MANAGED_ERROR_CODE,
  PrincipalIdSchema,
  SessionIdSchema,
  SessionSchema,
  VersionSchema,
} from "@happycastle/steel-managed-shared";
import { z } from "zod";
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
import { invalidManagedResourceIdentity } from "./errors.js";
import type { ManagedRouteRegistrar } from "./routes-types.js";

const SessionParamsSchema = z.object({ id: SessionIdSchema }).strict();
const AdmissionParamsSchema = z.object({ id: AdmissionIdSchema }).strict();

export const registerManagedResourceRoutes: ManagedRouteRegistrar = (
  app,
  options,
) => {
  app.get("/v1/managed/pool", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.POOL_SUMMARY);
        return options.poolMutations.parsePool(await options.port.readPool());
      },
    }),
  );

  app.get("/v1/managed/version", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.VERSION);
        return parseOutput(VersionSchema, await options.port.readVersion());
      },
    }),
  );

  app.get("/v1/managed/sessions/:id", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.SESSION_DETAIL);
        const { id } = parseInput(SessionParamsSchema, request.params);
        const found = await options.port.findSession(id);
        const parsed =
          found === undefined
            ? undefined
            : ownedResource({
                ownerId: parseOutput(PrincipalIdSchema, found.ownerId),
                resource: parseOutput(SessionSchema, found.resource),
              });
        if (parsed !== undefined && parsed.resource.sessionId !== id)
          throw invalidManagedResourceIdentity();
        return requireAuthorizedResource({
          code: MANAGED_ERROR_CODE.SESSION_NOT_FOUND,
          operation: AUTHORIZATION_OPERATION.SESSION_DETAIL,
          principal,
          resource: parsed,
        });
      },
    }),
  );

  app.get("/v1/managed/admissions/:id", async (request, reply) =>
    sendManagedResponse({
      reply,
      nextRequestId: options.nextRequestId,
      status: 200,
      action: async () => {
        const principal = parsePrincipal(
          await options.resolvePrincipal(request),
        );
        requireOperation(principal, AUTHORIZATION_OPERATION.ADMISSION_DETAIL);
        const { id } = parseInput(AdmissionParamsSchema, request.params);
        const found = await options.port.findAdmission(id);
        const parsed =
          found === undefined
            ? undefined
            : ownedResource({
                ownerId: parseOutput(PrincipalIdSchema, found.ownerId),
                resource: parseOutput(AdmissionSchema, found.resource),
              });
        if (parsed !== undefined && parsed.resource.admissionId !== id)
          throw invalidManagedResourceIdentity();
        return requireAuthorizedResource({
          code: MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND,
          operation: AUTHORIZATION_OPERATION.ADMISSION_DETAIL,
          principal,
          resource: parsed,
        });
      },
    }),
  );
};

export { AdmissionParamsSchema, SessionParamsSchema };
