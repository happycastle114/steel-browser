# Production dependency audit

This directory defines the fail-closed dependency gate used by the managed
manager and worker images. It audits the filesystem that is copied into the
runtime image, not the development workspace or a hypothetical lockfile tree.

## Guarantees

- Node is pinned to `22.23.1` and the official image digest recorded in
  `production-audit-policy.json`.
- Registry packages retain package-lock v3 SHA-512 integrity metadata and a
  canonical SHA-256 of their installed payload bytes.
- Workspace links must resolve inside the source tree and match their exact
  package-lock target.
- Required runtime workspaces must be real workspace links. A registry package
  with the same name cannot satisfy the policy.
- Registry packages must be reachable through production dependencies from the
  target's exact workspace roots. Unreachable packages and centrally named
  forbidden build packages fail the receipt.
- Installed critical or high advisories always fail. An absent lockfile-only
  advisory fails unless it has an exact source/node exception with a real,
  unexpired ISO date.
- Native package overlays are accepted only when the complete builder and
  installed directory trees have equal canonical SHA-256 hashes.
- Receipt generation validates the real process OS and architecture. The
  Linux/amd64 production policy cannot emit a receipt on macOS or arm64.

Do not run `npm audit fix --force`. It can replace application dependencies
outside the tested compatibility boundary and does not prove the runtime tree.

## Image workflow

Run all npm commands with the pinned Node image and an explicit registry:

```sh
npm ci --ignore-scripts --omit=dev \
  --workspace @steel-browser/api \
  --workspace @happycastle/steel-managed-shared \
  --workspace @happycastle/steel-managed-worker \
  --include-workspace-root=false

npm audit --json --omit=dev \
  --workspace @steel-browser/api \
  --workspace @happycastle/steel-managed-shared \
  --workspace @happycastle/steel-managed-worker \
  --include-workspace-root=false \
  --registry=https://registry.npmjs.org
```

The npm 11 workspace installer currently retains some dev and orphaned optional
dependencies despite `--omit=dev`. The runtime-dependency stage traverses
`dependencies`, installed `optionalDependencies`, and required peers from the
target's exact workspace roots. It removes every installed registry package
outside that production graph, as well as every package named by the target's
centralized `forbiddenPackages` policy:

```sh
node managed/security/prune-production-tree.mjs \
  --target WORKER \
  --root /runtime-deps
```

The pruner resolves every target through the installed package-lock inventory,
binds installed package bytes, and refuses workspace links, manifestless
package directories, or paths outside the install root. The receipt then
rebuilds the inventory with development packages forbidden, so a future npm
behavior change or an incomplete prune fails closed instead of silently
expanding the image.

Generate native evidence after copying the built `classic-level` and `duckdb`
trees into the pruned install:

```sh
node managed/security/generate-native-overlay-evidence.mjs \
  --target WORKER \
  --builder-root /workspace \
  --installed-root /runtime-deps \
  --output /tmp/steel-native-overlays.json
```

Then generate the receipt from the same installed root and raw audit bytes:

```sh
node managed/security/verify-production-audit.mjs \
  --target WORKER \
  --root /runtime-deps \
  --audit /tmp/steel-npm-audit.json \
  --audit-observed-at 2026-07-21T00:00:00Z \
  --native-overlays /tmp/steel-native-overlays.json \
  --source-revision 0000000000000000000000000000000000000000 \
  --source-tree-sha256 0000000000000000000000000000000000000000000000000000000000000000 \
  --output /tmp/steel-production-audit-receipt.json
```

Build automation supplies the real observation time and source hashes. The
example zero values document width only and are not valid release provenance.
Run this command inside the exact pinned Linux/amd64 image; local macOS output
is intentionally rejected and is never release evidence.

## Canonical bytes

Nested inventory and native-tree hashes use RFC 8785 canonical JSON without a
trailing newline. The top-level receipt uses the same canonical JSON followed
by exactly one LF byte. Any external `productionAuditReceiptSha256` includes
that LF byte. The receipt intentionally contains no final image ID; the
runtime-strategy receipt binds its hash to the image, avoiding a hash cycle.

## Compatibility overrides

Five security overrides intentionally cross an upstream semver range. Two are
present in the selected worker production tree:

| Consumer                             | Declared range    | Installed | Reason                                                       |
| ------------------------------------ | ----------------- | --------- | ------------------------------------------------------------ |
| `generative-bayesian-network@2.1.82` | `adm-zip ^0.5.9`  | `0.6.0`   | every `0.5.x` is affected by GHSA-xcpc-8h2w-3j85             |
| `duckdb@1.4.2`                       | `node-gyp ^9.4.1` | `12.4.0`  | the older build chain retains critically vulnerable node-tar |

`npm ls --omit=dev` reports these two nodes as `invalid` because it compares the
replaced version with the consumer's old declaration. This is not ignored:
npm's root `overrides` feature performs the replacement, the lockfile and
installed-content hashes bind the artifacts, the production audit scans those artifacts, and
`production-dependency-compatibility.test.mjs` executes the adm-zip,
fingerprint-generator, and DuckDB native APIs.

The full development workspace additionally reports these range crossings:

| Consumer                               | Declared range     | Installed | Scope                    |
| -------------------------------------- | ------------------ | --------- | ------------------------ |
| `@hey-api/openapi-ts`                  | `handlebars 4.7.8` | `4.7.9`   | code generation only     |
| `@typescript-eslint/typescript-estree` | `minimatch 9.0.3`  | `9.0.9`   | lint/type tooling only   |
| `giget`                                | `tar ^6.2.1`       | `7.5.20`  | development tooling only |

These packages are not admitted to a production receipt. The full pinned-Node
install, build, lint, formatting, and test gates exercise their consumers; the
runtime pruner independently removes every copy unreachable from the target's
production workspace graph.

Fastify is pinned to `5.8.5` across the API, gateway, and worker so TypeScript
does not load structurally different Fastify instances from nested workspaces.

## Current non-blocking findings

The 2026-07-21 worker runtime audit has zero critical findings, zero high
findings, and two moderate findings:

- `@fastify/static` advisories 1116758 and 1116759. The patched line currently
  targets a newer Fastify compatibility boundary and requires a route migration.
- `file-type` advisories 1114301 and 1114726. The patched release is a major
  upgrade and requires fixture coverage for the upload and scrape paths.

These are visible in the raw audit and receipt counts; they are not allowlisted
or erased. Critical and high remain the production blocking threshold.

## Maintenance

The repository supports Node 22+ for development, while production receipts
require exactly Node `22.23.1` and the pinned image digest. Update exact
versions, regenerate `package-lock.json` with Node `22.23.1`, run the
compatibility tests, and regenerate a real pruned receipt. If a bounded
lockfile-only exception is unavoidable, record exact advisory source IDs,
exact npm node paths, and a short expiry in the policy. Never add a wildcard or
an exception for an installed node.

Primary references:

- [npm package overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides)
- [npm audit command](https://docs.npmjs.com/cli/v11/commands/npm-audit)
- [Node official image](https://hub.docker.com/_/node)
- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
