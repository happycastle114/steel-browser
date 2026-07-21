import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_API_VERSION,
  MANAGED_ERROR_CATALOG,
  MANAGED_ROUTE_REGISTRY,
} from "@happycastle/steel-managed-shared";
import { z } from "zod";
import { renderGeneratedManagedClient } from "../src/api/operations/client-generation.js";
import { generatedManagedArtifacts } from "../src/api/operations/generated-artifacts.js";
import { createManagedOpenApiDocument } from "../src/api/operations/openapi-generation.js";
import { MANAGED_OPENAPI_OPERATIONS } from "../src/api/operations/openapi-contract.js";

const OperationDocumentSchema = z
  .object({
    operationId: z.string(),
    requestBody: z.unknown().optional(),
    responses: z.record(z.unknown()),
  })
  .passthrough();

const OpenApiDocumentSchema = z
  .object({
    info: z.object({ version: z.string() }).passthrough(),
    paths: z.record(z.record(OperationDocumentSchema)),
    components: z.object({ schemas: z.record(z.unknown()) }).passthrough(),
  })
  .passthrough();

class ManagedGenerationTestError extends Error {
  public override readonly name = "ManagedGenerationTestError";
}

function registryIdentity() {
  return MANAGED_ROUTE_REGISTRY.map(({ method, path, response }) => ({
    method,
    path,
    successStatus: response.status,
  }));
}

function openApiOperation(
  document: z.output<typeof OpenApiDocumentSchema>,
  path: string,
  method: string,
) {
  const operation = document.paths[path]?.[method];
  if (operation === undefined)
    throw new ManagedGenerationTestError(
      `missing OpenAPI operation: ${method} ${path}`,
    );
  return operation;
}

describe("managed API generated artifacts", () => {
  it("keeps runtime registry, OpenAPI source, and generated client inventory identical", () => {
    // Given
    const expected = registryIdentity();

    // When
    const openApi = MANAGED_OPENAPI_OPERATIONS.map(
      ({ method, path, successStatus }) => ({ method, path, successStatus }),
    );

    // Then
    expect(openApi).toEqual(expected);
    expect(renderGeneratedManagedClient()).toContain(
      `Object.freeze(${JSON.stringify(expected)})`,
    );
  });

  it("documents every exact operation, success, request body, and declared error status", () => {
    // Given
    const document = OpenApiDocumentSchema.parse(
      createManagedOpenApiDocument(),
    );

    // When / Then
    expect(document.info.version).toBe(CONTROL_PLANE_API_VERSION);
    for (const descriptor of MANAGED_OPENAPI_OPERATIONS) {
      const path = descriptor.path.replace(":id", "{id}");
      const operation = openApiOperation(
        document,
        path,
        descriptor.method.toLowerCase(),
      );
      const statuses = Object.keys(operation.responses)
        .map(Number)
        .sort((left, right) => left - right);
      const expectedStatuses = [
        descriptor.successStatus,
        ...descriptor.errorStatuses,
      ].sort((left, right) => left - right);
      expect(operation.operationId).toBe(descriptor.operationId);
      expect(statuses).toEqual(expectedStatuses);
      expect(operation.requestBody === undefined).toBe(
        descriptor.requestComponent === undefined,
      );
      for (const status of descriptor.errorStatuses) {
        const codes = descriptor.errorCodes.filter(
          (code) => MANAGED_ERROR_CATALOG[code].status === status,
        );
        expect(JSON.stringify(operation.responses[String(status)])).toContain(
          `"enum":${JSON.stringify(codes)}`,
        );
      }
    }
    expect(Object.keys(document.paths)).toHaveLength(
      MANAGED_ROUTE_REGISTRY.length,
    );
  });

  it("binds event sequence to canonical decimal strings and omits private ownership fields", () => {
    // Given
    const document = OpenApiDocumentSchema.parse(
      createManagedOpenApiDocument(),
    );

    // When
    const serialized = JSON.stringify(document.components.schemas["EventList"]);
    const fullDocument = JSON.stringify(document);

    // Then
    expect(serialized).toContain(
      '"sequence":{"type":"string","pattern":"^[1-9][0-9]{0,19}$"}',
    );
    expect(fullDocument).not.toContain("ownerId");
    expect(fullDocument).not.toContain("principalDigest");
    expect(fullDocument).not.toContain("privateOrigin");
  });

  it("matches both committed generated artifacts byte-for-byte", async () => {
    // Given
    const artifacts = generatedManagedArtifacts();

    // When
    const comparisons = await Promise.all(
      artifacts.map(async (artifact) => ({
        current: await readFile(artifact.path, "utf8"),
        generated: artifact.content,
      })),
    );

    // Then
    for (const comparison of comparisons)
      expect(comparison.current).toBe(comparison.generated);
  });
});
