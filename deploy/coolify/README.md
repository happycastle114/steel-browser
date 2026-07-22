# Managed Steel on Coolify

This directory is the production source boundary for the managed Steel fork. It contains two
generated Docker Compose documents, one for `managed-blue-pool` and one for
`managed-green-pool`. Only one project may run at a time. Workers have no public network, host
port, Docker socket, capability, or manager secret; only the manager joins the Coolify proxy
network.

The files contain JSON syntax because JSON is valid YAML and gives deterministic generated
bytes. `managed/release/coolify-source-compose.mjs` is the source generator and
`npm run test:managed-release` proves that both checked-in documents materialize into the exact
release Compose policy.

## Coolify applications

Create two Git-based Docker Compose applications from the fork's canonical `production` branch:

| Application | Compose location | Initial state |
| --- | --- | --- |
| Steel managed blue | `/deploy/coolify/compose.blue.yml` | stopped |
| Steel managed green | `/deploy/coolify/compose.green.yml` | stopped |

Set **Connect to predefined network**, enable **Deploy raw compose**, and disable container-label
dollar escaping. Coolify 4.1.x otherwise auto-attaches its generated `.env` file to every parsed
service, which would expose manager-only Compose inputs to the workers. Raw Compose still receives
the deployment `--env-file` for interpolation but preserves the checked-in per-service environment
boundary. The generated Compose explicitly attaches only the manager to the external `coolify`
network. Do not add a domain or port to either worker service.

Coolify treats the Compose file as the source of truth and recognizes `${VARIABLE:?message}` as a
required value. See the official [Docker Compose deployment guide](https://coolify.io/docs/knowledge-base/docker/compose)
and [environment-variable guide](https://coolify.io/docs/knowledge-base/environment-variables).

## Required values

The release workflow writes the exact image references and evidence values. The remaining values
are deployment configuration:

| Variable | Source | Container visibility |
| --- | --- | --- |
| `STEEL_MANAGED_MANAGER_IMAGE` | Release manifest; digest-pinned | Compose only |
| `STEEL_MANAGED_WORKER_IMAGE` | Release manifest; digest-pinned | Compose only |
| `STEEL_MANAGED_RELEASE_EVIDENCE_JSON` | Release artifact; canonical one-line JSON | manager secret file only |
| `STEEL_MANAGED_RELEASE_EVIDENCE_SHA256` | Release manifest | manager command only |
| `STEEL_MANAGED_CREATE_TOKEN_KEY_HEX` | One shared 64-character lowercase-hex secret | manager secret file only |
| `STEEL_MANAGED_CONFIG_JSON` | Canonical one-line manager configuration | manager environment |
| `STEEL_MANAGED_ROUTE_HOST` | Candidate or production hostname | proxy label only |

The create-token key must be identical in blue and green. It is never passed to a worker or
stored in a generated env file. Docker Compose materializes it as a manager-only file; PID 1
validates root ownership and mode, copies it into a private tmpfs, drops every capability and
changes to UID/GID 10001 before starting Node.

Docker Compose cannot materialize an environment-backed secret for a service whose root
filesystem is marked read-only. The manager therefore keeps `read_only: false` only for the
root-owned scratch image during its short PID 1 initialization. The long-running Node process
still runs as UID/GID 10001 with all capabilities dropped, `no-new-privileges`, private secret
tmpfs, bounded PID/memory limits, and no writable application directory. Both workers remain
`read_only: true` and never receive either manager secret.

A minimal configuration envelope is:

```json
{
  "schemaVersion": 1,
  "controlPlane": {
    "managerBaseP95Bytes": 100000000,
    "accessIssuer": "https://YOUR_TEAM.cloudflareaccess.com",
    "accessAudience": "YOUR_ACCESS_APPLICATION_AUDIENCE",
    "operatorServicePrincipals": ["steel-managed-operator"]
  },
  "publicEndpoints": [
    {
      "host": "steel-candidate.soungmin.tech",
      "origin": "https://steel-candidate.soungmin.tech",
      "role": "CANDIDATE"
    },
    {
      "host": "steel.soungmin.tech",
      "origin": "https://steel.soungmin.tech",
      "role": "PRODUCTION"
    }
  ]
}
```

Cloudflare Access must protect both hosts and forward its signed
`Cf-Access-Jwt-Assertion`. The configured service-token common name becomes an operator only when
it is listed in `operatorServicePrincipals`.

## Release and deployment

`.github/workflows/managed-release.yml` performs the production path on Linux/amd64:

1. Run the complete managed test/type/schema/security gates on Node 22.23.1 and Rust 1.91.1.
2. Build manager and worker from isolated Git archives twice.
3. Export and verify a production dependency-audit receipt for each image.
4. Push SBOM/provenance-bearing images, read back OCI index/platform/config digests, and reject a
   non-reproducible pair.
5. Run Chromium from the exact worker digest and bind its version into release evidence.
6. Generate `release-evidence.json`, the release manifest, and exact blue/green Compose artifacts.
7. On an explicit `workflow_dispatch`, verify both Coolify applications are stopped, update one
   target, start it, and wait for a finished deployment plus a running application state.

For an already-built release, `.github/workflows/managed-promotion.yml` provides a separate,
serialized promotion path without rebuilding either image. Update
`deploy/coolify/promotion-request.json` on `production` with the successful release run ID, its
exact 40-character source revision, the stopped `BLUE` or `GREEN` slot, and the routed hostname.
The workflow downloads only the matching immutable release artifact from that run, verifies its
manifest and evidence digest, and then invokes the same fail-closed Coolify deployment client.
Changing the promotion request does not trigger the image release workflow.

```json
{
  "schemaVersion": 1,
  "requestId": "steel-production-20260722-01",
  "releaseRunId": 123456789,
  "releaseRevision": "0123456789abcdef0123456789abcdef01234567",
  "targetSlot": "BLUE",
  "routeHost": "steel.soungmin.tech"
}
```

Configure these GitHub Actions secrets without putting their values in the repository:

- `COOLIFY_API_BASE` (for example `https://coolify.example/api/v1`)
- `COOLIFY_API_TOKEN` with the minimum `read`, `write`, and `deploy` permissions
- `COOLIFY_BLUE_APPLICATION_UUID`
- `COOLIFY_GREEN_APPLICATION_UUID`
- `STEEL_MANAGED_CONFIG_JSON`
- `STEEL_MANAGED_CREATE_TOKEN_KEY_HEX`

The workflow publishes the manager and worker to GHCR. Either make those packages public or add a
read-only GHCR registry in Coolify before deployment. Keep registry credentials in Coolify's
registry settings; do not add them to Compose or the application environment.

All seven Coolify variables are available to both Coolify build-time and runtime Compose
interpolation. Coolify 4.1.x invokes Docker Compose with its runtime `.env` file, so disabling the
runtime flag removes required `${VARIABLE}` values before Compose can start. Its parsed-Compose
mode also auto-adds that file as `env_file` to every service, so production must use raw-Compose
mode. The checked-in Compose then exposes only the explicit manager config, manager-only secrets,
image references, and proxy route. Neither worker service references the manager config,
create-token key, or release evidence.

The deployment client uses Coolify's official [bulk environment update](https://coolify.io/docs/api-reference/api/applications/update-envs-by-application-uuid),
[application start](https://coolify.io/docs/api-reference/api/applications/start-application-by-uuid),
and [deployment readback](https://next.coolify.io/docs/api-reference/api/deployments/get-deployment-by-uuid)
endpoints. It never prints the API token, create-token key, configuration JSON, or release-evidence
body. Raw Compose is a one-time application setting in Coolify 4.1.x; its application update API
rejects that field, so provision both blue/green slots through the UI before using the automated
promotion client. A missing raw-mode setting fails closed because the worker rejects manager-only
environment variables.

The manager intentionally starts in `DRAINING`. After worker reconciliation is healthy, an
authenticated operator must call `POST /v1/managed/pool/resume` with the current manager instance
ID, worker generations, idempotency key, and exact handover proof. Production traffic must remain
on maintenance or the old owner until that response reports `SERVING`.

## Codex and OpenCode

The repository includes project-scoped clients:

- `.codex/config.toml` configures Codex Streamable HTTP at
  `https://steel.soungmin.tech/mcp` using `env_http_headers`.
- `opencode.json` configures OpenCode remote MCP with OAuth disabled and `{env:...}` Access
  headers.

Both read `STEEL_CF_ACCESS_CLIENT_ID` and `STEEL_CF_ACCESS_CLIENT_SECRET` from the client process
environment. No credential value is committed and neither configuration calls a credential
helper or macOS Keychain. Restart the client after providing those environment variables.

Codex officially supports Streamable HTTP MCP servers and environment-backed HTTP headers in
`config.toml`; OpenCode documents remote MCP headers and `{env:VARIABLE}` interpolation in its
[MCP server guide](https://opencode.ai/docs/mcp-servers/).

Useful authenticated surfaces are:

- `GET /v1/tools` — canonical 14-tool inventory and schema digests
- `POST /mcp` — Streamable HTTP MCP transport
- `POST /v1/actions` and `GET /v1/results/:id` — async REST agent transport
- `GET /v1/managed/sessions` and `GET /v1/managed/workers` — operations state
- `GET /ui/` — operations console

## Upstream maintenance

`.github/workflows/managed-upstream-sync.yml` runs weekly. It merges the current
`steel-dev/steel-browser` `main` into an isolated automation branch and opens a PR against
`production`; it never writes directly to the release branch. Compatibility failures remain visible
on the PR. A source change is not releasable until the observed protocol corpus, upstream image
digest, Chromium readback, and managed release evidence are refreshed and all gates pass.

## Capacity and acceptance

The active project reserves 1280 MiB and limits 2560 MiB per worker, plus a 256/512 MiB
manager reservation/limit and 512 MiB shared memory per worker. Verify Synology host memory, disk,
inode, pressure, and image-extraction headroom before starting either project.

Acceptance requires all of the following, not merely a green Coolify badge:

- exact container digests and release-evidence SHA match the release artifact;
- both workers are healthy and remain private;
- manager health, `/v1/tools`, `/mcp`, UI, and public compatibility routes pass through Access;
- two simultaneous sessions can create, navigate, observe CDP, and release independently;
- Codex and OpenCode can list and invoke the same 14 tools;
- the non-target blue/green project and the previous legacy Steel owner are stopped;
- cleanup leaves zero sessions, zero retained results, and idle workers.
