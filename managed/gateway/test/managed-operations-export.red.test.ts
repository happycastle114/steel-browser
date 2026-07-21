import { describe, expect, it } from "vitest";

describe("managed operations API registration", () => {
  it("exposes the Fastify registration seam when the managed API is built", async () => {
    // Given: the gateway package is the only production composition boundary.
    const gateway = await import("../src/index.js");

    // When: a manager composition inspects the gateway exports.
    const isRegistered = "registerManagedOperationsApi" in gateway;

    // Then: the managed operations adapter is available for injection.
    expect(isRegistered).toBe(true);
  });
});
