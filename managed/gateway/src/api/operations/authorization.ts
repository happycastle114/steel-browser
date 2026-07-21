import {
  AUTHORIZATION_ACCESS,
  MANAGED_ERROR_CODE,
  authorizationAccess,
  filterAuthorizedResources,
  type AuthorizationOperation,
  type OwnedAuthorizationResource,
  type PrincipalId,
} from "@happycastle/steel-managed-shared";
import { ManagedOperationsError } from "./errors.js";
import type { ManagedPrincipal } from "./port.js";

type ResourceNotFoundCode =
  | typeof MANAGED_ERROR_CODE.SESSION_NOT_FOUND
  | typeof MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND;

export function requireOperation(
  principal: ManagedPrincipal,
  operation: AuthorizationOperation,
): void {
  const access = authorizationAccess(principal.role, operation);
  switch (access) {
    case AUTHORIZATION_ACCESS.DENY:
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.ACCESS_FORBIDDEN,
        message: "Managed operation forbidden",
      });
    case AUTHORIZATION_ACCESS.GLOBAL:
    case AUTHORIZATION_ACCESS.OWN:
    case AUTHORIZATION_ACCESS.ANY_OWNER:
    case AUTHORIZATION_ACCESS.CREATOR:
      return;
  }
}

export function authorizedResources<Resource>(
  input: Readonly<{
    operation: AuthorizationOperation;
    principal: ManagedPrincipal;
    resources: readonly OwnedAuthorizationResource<Resource>[];
  }>,
): readonly Resource[] {
  return filterAuthorizedResources({
    operation: input.operation,
    principalId: input.principal.principalId,
    resources: input.resources,
    role: input.principal.role,
  });
}

export function requireAuthorizedResource<Resource>(
  input: Readonly<{
    code: ResourceNotFoundCode;
    operation: AuthorizationOperation;
    principal: ManagedPrincipal;
    resource: OwnedAuthorizationResource<Resource> | undefined;
  }>,
): Resource {
  const visible =
    input.resource === undefined
      ? []
      : authorizedResources({
          operation: input.operation,
          principal: input.principal,
          resources: [input.resource],
        });
  const resource = visible[0];
  if (resource === undefined)
    throw new ManagedOperationsError({
      code: input.code,
      message: missingMessage(input.code),
    });
  return resource;
}

export function ownedResource<Resource>(
  input: Readonly<{
    ownerId: PrincipalId;
    resource: Resource;
  }>,
): OwnedAuthorizationResource<Resource> {
  return { ownerId: input.ownerId, resource: input.resource };
}

function missingMessage(code: ResourceNotFoundCode): string {
  switch (code) {
    case MANAGED_ERROR_CODE.SESSION_NOT_FOUND:
      return "Session not found";
    case MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND:
      return "Admission not found";
  }
}
