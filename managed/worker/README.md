# Managed worker bootstrap

This package is the private, in-process Steel worker bootstrap used by the
Coolify deployment. It keeps the upstream plugin's HTTP and WebSocket routes,
adds stable worker and boot-instance HTTP response headers, and reports readiness
only after upstream `onListen` bootstrap completes. Process signals close the
Fastify server through the upstream CDP cleanup lifecycle.

`GET /v1/managed-worker/active-session` is the bounded manager observation
surface. It returns only the current live session ID or `null`; it never exposes
the upstream append-only session history or private session details.
`MANAGED_WORKER_ID` accepts only the generated two-worker identities,
`worker-00` or `worker-01`.

This package is not the complete Task 22 worker supervisor. The following stay
explicitly deferred to that task:

- a port 3000 supervisor proxying an untouched upstream process on loopback 3001;
- the create journal, active enumeration, token lookup, replay, and recovery state machine;
- WebSocket-upgrade identity injection plus public-edge header rejection and stripping;
- the pinned non-root worker image, browser/toolchain metadata, SBOM, and provenance;
- the generated two-worker Coolify Compose topology and full REST/WebSocket corpus runner.

Until those pieces and their required artifacts exist, this package must not be
reported as completing Task 22 or as a deployable managed control plane.
