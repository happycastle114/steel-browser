# Managed gateway core

This package owns the in-memory worker, admission, affinity, reconciliation, session lifecycle,
framework-neutral public REST/WebSocket transport boundaries, managed operations adapters, and
injectable managed AI REST/MCP transports. It does not open a listener or bind Host, Access,
storage, control-plane, or UI composition by itself.

## Managed operations adapter

`registerManagedOperationsApi` binds the exact thirteen `/v1/managed` operations to Fastify. The
adapter requires injected authentication resolution and a `ManagedOperationsPort`; production
resources are never backed by an internal fixture store. It provides owner-aware authorization,
immutable list snapshots, bigint event cursors, and pool-mutation replay.
The pool adapter accepts one parsed `ControlPlaneConfig`; response validation, replay expiry,
pool identity, queue capacity, and memory budgets derive from that same object, while replay
capacity remains the shared fixed control-plane limit.

The source OpenAPI is generated at `openapi/managed.json`. The browser-safe generated client is the
separate `@happycastle/steel-managed-operations-client` workspace and consumes only
`@happycastle/steel-managed-shared/browser`.

## Managed AI transport contract

`createManagedAiTransportPlugin` mounts REST endpoints at `/v1/capabilities`, `/v1/tools`,
`/v1/actions`, and `/v1/results/:id`, plus a stateless `/mcp` endpoint. The Coolify manager owns
Cloudflare Access, Host selection, and ingress body accounting once; it injects the already-validated
principal, request/correlation IDs, and selected public origin. Request headers never supply identity
to this adapter.

The MCP endpoint uses the official `@modelcontextprotocol/sdk` 1.29.0 Streamable HTTP server with
protocol revision `2025-11-25`. A thin protocol boundary enforces exact selected Host/Origin
binding, media negotiation, stateless headers, and single-message requests before the SDK. Both
REST and MCP invoke the same required execution port and two-phase retained-result service. The
service reserves memory before execution, validates config-bound outputs, stages before ledger
commit, publishes only committed results, and quarantines corrupt retained data. The returned
adapter exposes idempotent `close()` and action/result gauges for manager shutdown and metrics.

## Worker foundation contract

The current adapter consumes the canonical shared private-supervisor contract:

- `GET /v1/managed-worker/meta` returns the configured worker ID, boot-unique UUID v4 instance ID,
  pinned upstream/browser versions, and create-journal version.
- `GET /v1/managed-worker/creates?scope=active` returns at most one strictly typed nonterminal
  create record. Pending or uncertain records keep the worker busy without inventing a live session.
- `GET /v1/managed-worker/creates/:token` is the typed replay lookup boundary; create tokens are
  canonical keyed hashes or lowercase UUID v4 tokens.
- Session create/release use the raw upstream Steel routes and envelopes.
- The caller-supplied UUID session ID is the public and upstream session ID.
- Every normal HTTP response carries the worker/instance identity headers. Before and after each raw
  session operation, the adapter also re-reads metadata and rejects a changed worker generation.

Discovery is overlay-bound to `STATIC_CONFIG` with exactly `worker-00=http://worker-00:3000` and
`worker-01=http://worker-01:3000`. The provider factory rejects DNS/selector input, duplicate
origins, public origins, and non-exact service ports before reconciliation. Bounded client calls
require both private identity headers; metadata binds the body to the configured worker ID and
boot-unique instance UUID, while list/create/release calls remain bound to that same pair.

The shared contract defines both active enumeration and per-token replay lookup. The gateway only
consumes active enumeration for startup recovery; replay lookup remains owned by the worker and
manager control-plane boundary. Raw Node WebSocket upgrades carry the same worker-generation
identity and are independently fenced before public traffic is accepted. Startup recovery derives
a deterministic internal allocation ID from the caller-supplied session UUID and fails closed on
conflicts.
