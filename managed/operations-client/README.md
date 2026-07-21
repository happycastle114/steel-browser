# Managed operations client

Browser-safe generated client for the additive managed operations API.

- Package: `@happycastle/steel-managed-operations-client`
- Source of truth: `managed/gateway/src/api/operations/openapi-contract.ts`
- Generated source: `src/index.ts`
- Runtime contracts: `@happycastle/steel-managed-shared/browser`

Regenerate and verify from the repository root:

```sh
npm run generate:managed-api
npm run check:managed-api-drift
npm run check:managed-operations-browser
```

Callers inject a browser-compatible fetch adapter and the canonical parsed `ControlPlaneConfig` used by the manager. The client derives its pool response schema from that config; callers cannot inject an independent TTL, capacity, or schema. Detail and mutation methods require an explicit resource ID and reject a response bound to a different resource or manager mode.
