FROM docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS node-build

ARG MANAGED_SOURCE_REVISION
ARG SOURCE_DATE_EPOCH

ENV SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}"

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY ui/package.json ./ui/package.json
COPY repl/package.json ./repl/package.json
COPY managed/shared/package.json ./managed/shared/package.json
COPY managed/gateway/package.json ./managed/gateway/package.json
COPY managed/console/package.json ./managed/console/package.json
COPY managed/worker/package.json ./managed/worker/package.json
COPY managed/manager/package.json ./managed/manager/package.json
COPY managed/tsconfig.base.json ./managed/tsconfig.base.json

RUN npm pkg set scripts.prepare="echo skip-husky" && npm ci --include=dev

COPY managed/shared ./managed/shared
COPY managed/gateway ./managed/gateway
COPY managed/console ./managed/console
COPY managed/manager ./managed/manager

RUN test "$(node --version)" = "v22.23.1" && \
    npm run build -w @happycastle/steel-managed-shared -w @happycastle/steel-managed-gateway -w @happycastle/steel-managed-manager && \
    npm run build -w @happycastle/steel-managed-console && \
    node managed/manager/build/ui/asset-manifest-cli.js managed/console/dist && \
    ! grep -R -E '(_showcase|fixtures/|\.map($|"))' managed/console/dist && \
    MANAGED_SOURCE_REVISION="${MANAGED_SOURCE_REVISION}" SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}" \
      node managed/manager/image/write-runtime-source-manifest.mjs runtime-source-manifest.json && \
    npm prune --omit=dev --workspace @happycastle/steel-managed-shared --workspace @happycastle/steel-managed-gateway --workspace @happycastle/steel-managed-manager

FROM docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS runtime-dependencies

WORKDIR /runtime-deps

COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY ui/package.json ./ui/package.json
COPY repl/package.json ./repl/package.json
COPY managed/shared/package.json ./managed/shared/package.json
COPY managed/gateway/package.json ./managed/gateway/package.json
COPY managed/console/package.json ./managed/console/package.json
COPY managed/worker/package.json ./managed/worker/package.json
COPY managed/manager/package.json ./managed/manager/package.json
COPY managed/security ./managed/security

RUN npm ci --ignore-scripts --omit=dev --workspace @happycastle/steel-managed-shared --workspace @happycastle/steel-managed-gateway --workspace @happycastle/steel-managed-manager --include-workspace-root=false
RUN node managed/security/prune-production-tree.mjs --target MANAGER --root /runtime-deps

FROM runtime-dependencies AS production-audit

ARG MANAGED_AUDIT_OBSERVED_AT
ARG MANAGED_SOURCE_REVISION
ARG MANAGED_SOURCE_TREE_SHA256

RUN set -eu; \
    node managed/security/generate-native-overlay-evidence.mjs \
      --target MANAGER \
      --builder-root /runtime-deps \
      --installed-root /runtime-deps \
      --output /tmp/steel-native-overlays.json; \
    audit_exit=0; \
    npm audit --registry=https://registry.npmjs.org --omit=dev --workspace @happycastle/steel-managed-shared --workspace @happycastle/steel-managed-gateway --workspace @happycastle/steel-managed-manager --include-workspace-root=false --json > /tmp/steel-production-audit-report.json || audit_exit=$?; \
    if [ "${audit_exit}" -gt 1 ]; then exit "${audit_exit}"; fi; \
    node managed/security/verify-production-audit.mjs \
      --target MANAGER \
      --root /runtime-deps \
      --audit /tmp/steel-production-audit-report.json \
      --audit-observed-at "${MANAGED_AUDIT_OBSERVED_AT}" \
      --native-overlays /tmp/steel-native-overlays.json \
      --source-revision "${MANAGED_SOURCE_REVISION}" \
      --source-tree-sha256 "${MANAGED_SOURCE_TREE_SHA256}" \
      --output /tmp/steel-production-audit.json

FROM scratch AS production-audit-export

COPY --from=production-audit /tmp/steel-production-audit.json /production-dependency-audit.json

FROM runtime-dependencies AS runtime-entry-check

COPY --from=node-build /workspace/managed/shared/build /runtime-deps/managed/shared/build

RUN node --input-type=module -e 'await import("file:///runtime-deps/managed/shared/build/index.js")'

FROM docker.io/library/rust:1.91.1-bookworm@sha256:c1e5f19e773b7878c3f7a805dd00a495e747acbdc76fb2337a4ebf0418896b33 AS init-build

WORKDIR /workspace/init
COPY managed/manager/init/Cargo.toml managed/manager/init/Cargo.lock ./
COPY managed/manager/init/src ./src
RUN test "$(rustc --version)" = "rustc 1.91.1 (ed61e7d7e 2025-11-07)" && \
    cargo build --release --locked --bin steel-manager-init

FROM docker.io/library/node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime-files

ARG MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256

COPY --from=init-build /workspace/init/target/release/steel-manager-init /runtime-input/steel-manager-init
COPY --from=node-build /etc/ssl/certs/ca-certificates.crt /runtime-input/ca-certificates.crt
COPY managed/manager/image/manager-launcher.cjs /runtime-input/steel-managed-manager
COPY managed/manager/image/healthcheck-launcher.cjs /runtime-input/steel-manager-healthcheck
COPY --from=production-audit-input /production-dependency-audit.json /runtime-input/production-dependency-audit.json

RUN set -eu; \
    test "$(node --version)" = "v22.23.1"; \
    install -d -m 0755 /runtime-root/usr/local/bin /runtime-root/etc/ssl/certs /runtime-root/licenses/steel-manager /runtime-root/app/managed; \
    install -d -m 0700 /runtime-root/run/steel-secret-source /runtime-root/run/steel-release-evidence-source; \
    install -d -m 0755 /runtime-root/run/steel; \
    install -d -m 1777 /runtime-root/tmp; \
    install -d -m 0700 -o 10001 -g 10001 /runtime-root/tmp/home; \
    install -m 0555 /usr/local/bin/node /runtime-root/usr/local/bin/node; \
    install -m 0555 /runtime-input/steel-manager-init /runtime-root/usr/local/bin/steel-manager-init; \
    install -m 0555 /runtime-input/steel-managed-manager /runtime-root/usr/local/bin/steel-managed-manager; \
    install -m 0555 /runtime-input/steel-manager-healthcheck /runtime-root/usr/local/bin/steel-manager-healthcheck; \
    install -m 0444 /runtime-input/production-dependency-audit.json /runtime-root/app/managed/production-dependency-audit.json; \
    test "$(sha256sum /runtime-root/app/managed/production-dependency-audit.json | cut -d ' ' -f 1)" = "${MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256}"; \
    for executable in /usr/local/bin/node /runtime-input/steel-manager-init; do \
      ldd "${executable}" | awk '{ if ($3 ~ /^\//) print $3; else if ($1 ~ /^\//) print $1 }'; \
    done | sort -u | while IFS= read -r library; do cp --parents "${library}" /runtime-root; done; \
    install -m 0444 /runtime-input/ca-certificates.crt /runtime-root/etc/ssl/certs/ca-certificates.crt; \
    cp /etc/nsswitch.conf /runtime-root/etc/nsswitch.conf; \
    printf 'root:x:0:0:root:/nonexistent:/usr/sbin/nologin\nsteel-managed:x:10001:10001:steel managed:/tmp/home:/usr/sbin/nologin\n' > /runtime-root/etc/passwd; \
    printf 'root:x:0:\nsteel-managed:x:10001:\n' > /runtime-root/etc/group

FROM scratch AS production

ARG MANAGED_SOURCE_REVISION
ARG MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256
ARG SOURCE_DATE_EPOCH

COPY --from=runtime-files /runtime-root /
COPY --from=runtime-dependencies /runtime-deps/node_modules /app/node_modules
COPY --from=runtime-dependencies /runtime-deps/managed/shared/node_modules /app/managed/shared/node_modules
COPY --from=runtime-dependencies /runtime-deps/managed/gateway/node_modules /app/managed/gateway/node_modules
COPY --from=runtime-dependencies /runtime-deps/managed/manager/node_modules /app/managed/manager/node_modules
COPY --from=runtime-entry-check /runtime-deps/managed/shared/build /app/managed/shared/build
COPY --from=runtime-entry-check /runtime-deps/managed/shared/package.json /app/managed/shared/package.json
COPY --from=node-build /workspace/managed/gateway/build /app/managed/gateway/build
COPY --from=node-build /workspace/managed/gateway/package.json /app/managed/gateway/package.json
COPY --from=node-build /workspace/managed/manager/build /app/managed/manager/build
COPY --from=node-build /workspace/managed/manager/package.json /app/managed/manager/package.json
COPY --from=node-build /workspace/managed/console/dist /srv/steel-console
COPY --from=node-build /workspace/runtime-source-manifest.json /licenses/steel-manager/runtime-source-manifest.json
COPY LICENSE /licenses/steel-manager/LICENSE
COPY managed/manager/image/NOTICE /licenses/steel-manager/NOTICE
COPY managed/manager/image/SOURCE.json /licenses/steel-manager/SOURCE.json
COPY managed/manager/image/base-images.lock.json /licenses/steel-manager/base-images.lock.json

LABEL org.opencontainers.image.title="Happycastle Steel managed manager" \
      org.opencontainers.image.description="Authenticated bounded Steel managed control plane" \
      org.opencontainers.image.source="https://github.com/happycastle114/steel-browser" \
      org.opencontainers.image.url="https://github.com/happycastle114/steel-browser" \
      org.opencontainers.image.documentation="https://github.com/happycastle114/steel-browser/tree/managed/managed/manager" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.revision="${MANAGED_SOURCE_REVISION}" \
      dev.happycastle.steel.source-date-epoch="${SOURCE_DATE_EPOCH}" \
      dev.happycastle.steel.production-audit.sha256="${MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256}" \
      dev.happycastle.steel.manager.node-version="22.23.1" \
      dev.happycastle.steel.manager.init-uid="0" \
      dev.happycastle.steel.manager.runtime-uid="10001" \
      dev.happycastle.steel.manager.console-proof="STARTUP_SHA256_READBACK"

ENV NODE_ENV="production" \
    HOME="/tmp/home" \
    TMPDIR="/tmp" \
    PATH="/usr/local/bin"

WORKDIR /app
USER 0:0
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 CMD ["/usr/local/bin/steel-manager-healthcheck", "http://127.0.0.1:3001/livez"]
ENTRYPOINT ["/usr/local/bin/steel-manager-init"]
