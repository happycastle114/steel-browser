# Managed gateway core

This package owns only the in-memory worker, admission, affinity, reconciliation, and session
lifecycle core. It intentionally exposes no public HTTP, WebSocket, AI, MCP, or UI routes.

## Worker foundation contract

The current adapter matches the committed worker wrapper foundation:

- `GET /v1/managed-worker/meta` returns the configured worker ID, boot-unique UUID v4 instance ID,
  and `READY` status.
- `GET /v1/managed-worker/active-session` returns a bounded zero-or-one current-session envelope;
  the gateway never enumerates upstream's append-only released-session history.
- Session create/release use the raw upstream Steel routes and envelopes.
- The caller-supplied UUID session ID is the public and upstream session ID.
- Every normal HTTP response carries the worker/instance identity headers. Before and after each raw
  session operation, the adapter also re-reads metadata and rejects a changed worker generation.

The worker foundation does not yet expose the private create journal/active-create enumeration
required for crash-safe keyed replay, and raw Node WebSocket upgrades do not yet carry the identity
headers. Those are explicit Task22 supervisor/shared-contract dependencies. The adapter boundary is
isolated so journal calls can be added without changing registry, admission, affinity, or lifecycle
interfaces. Until then, startup recovery derives only a deterministic internal allocation ID from
the caller-supplied session UUID and fails closed on conflicts.
