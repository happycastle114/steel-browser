FROM docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS build

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
COPY managed/tsconfig.base.json ./managed/tsconfig.base.json

RUN HUSKY=0 npm ci --include=dev

COPY api ./api
COPY ui ./ui
COPY managed/shared ./managed/shared
COPY managed/worker ./managed/worker

RUN npm run build -w @happycastle/steel-managed-shared && \
    npm run build -w @steel-browser/api && \
    VITE_API_URL="" VITE_WS_URL="" npm run build -w ui -- --base=/ui && \
    cd api/extensions/recorder && npm ci --include=dev && npm run build && npm prune --omit=dev && cd - && \
    npm run build -w @happycastle/steel-managed-worker && \
    MANAGED_SOURCE_REVISION="${MANAGED_SOURCE_REVISION}" SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}" node managed/worker/image/write-runtime-source-manifest.mjs runtime-source-manifest.json

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
COPY managed/security ./managed/security

RUN npm ci --ignore-scripts --omit=dev --workspace @steel-browser/api --workspace @happycastle/steel-managed-shared --workspace @happycastle/steel-managed-worker --include-workspace-root=false
RUN node managed/security/prune-production-tree.mjs --target WORKER --root /runtime-deps

COPY --from=build /workspace/node_modules/classic-level /workspace/node_modules/classic-level
COPY --from=build /workspace/node_modules/duckdb /workspace/node_modules/duckdb
COPY --from=build /workspace/node_modules/classic-level /runtime-deps/node_modules/classic-level
COPY --from=build /workspace/node_modules/duckdb /runtime-deps/node_modules/duckdb

FROM runtime-dependencies AS production-audit

ARG MANAGED_AUDIT_OBSERVED_AT
ARG MANAGED_SOURCE_REVISION
ARG MANAGED_SOURCE_TREE_SHA256

RUN set -eu; \
    node managed/security/generate-native-overlay-evidence.mjs \
      --target WORKER \
      --builder-root /workspace \
      --installed-root /runtime-deps \
      --output /tmp/steel-native-overlays.json; \
    audit_exit=0; \
    npm audit --registry=https://registry.npmjs.org --omit=dev --workspace @steel-browser/api --workspace @happycastle/steel-managed-shared --workspace @happycastle/steel-managed-worker --include-workspace-root=false --json > /tmp/steel-production-audit-report.json || audit_exit=$?; \
    if [ "${audit_exit}" -gt 1 ]; then exit "${audit_exit}"; fi; \
    node managed/security/verify-production-audit.mjs \
      --target WORKER \
      --root /runtime-deps \
      --audit /tmp/steel-production-audit-report.json \
      --audit-observed-at "${MANAGED_AUDIT_OBSERVED_AT}" \
      --native-overlays /tmp/steel-native-overlays.json \
      --source-revision "${MANAGED_SOURCE_REVISION}" \
      --source-tree-sha256 "${MANAGED_SOURCE_TREE_SHA256}" \
      --output /tmp/steel-production-audit.json

FROM scratch AS production-audit-export

COPY --from=production-audit /tmp/steel-production-audit.json /production-dependency-audit.json

FROM ghcr.io/steel-dev/steel-browser@sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d AS upstream

FROM upstream AS prepared

ARG MANAGED_SOURCE_REVISION
ARG MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256
ARG SOURCE_DATE_EPOCH

USER 0:0

RUN case "${MANAGED_SOURCE_REVISION}" in \
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; \
      *) exit 64 ;; \
    esac && \
    case "${SOURCE_DATE_EPOCH}" in *[!0-9]*|'') exit 64 ;; esac && \
    test "$(node --version)" = "v22.13.0" && \
    groupadd --gid 10001 steel-managed && \
    useradd --uid 10001 --gid 10001 --home-dir /tmp/home --no-create-home --shell /usr/sbin/nologin steel-managed && \
    case "${MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256}" in \
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; \
      *) exit 64 ;; \
    esac && \
    mkdir -p /app/managed/worker/build /app/managed /licenses/steel-browser && \
    rm -rf /app/node_modules /app/api/build /app/api/node_modules /app/api/extensions/recorder /app/ui/dist && \
    rm -rf /files /app/.cache /app/api/user-data-dir && \
    ln -s /tmp/files /files && \
    ln -s /tmp/cache /app/.cache && \
    ln -s /var/lib/steel/profile/persist /app/api/user-data-dir

COPY --from=runtime-dependencies /runtime-deps/node_modules /app/node_modules
COPY --from=build /workspace/api/build /app/api/build
COPY --from=runtime-dependencies /runtime-deps/api/node_modules /app/api/node_modules
COPY --from=build /workspace/api/extensions/recorder/dist /app/api/extensions/recorder/dist
COPY --from=build /workspace/api/extensions/recorder/icon.png /app/api/extensions/recorder/icon.png
COPY --from=build /workspace/api/extensions/recorder/manifest.json /app/api/extensions/recorder/manifest.json
COPY --from=build /workspace/api/extensions/recorder/package-lock.json /app/api/extensions/recorder/package-lock.json
COPY --from=build /workspace/api/extensions/recorder/package.json /app/api/extensions/recorder/package.json
COPY --from=build /workspace/ui/dist /app/ui/dist
COPY --from=build /workspace/managed/shared/build /app/managed/shared/build
COPY --from=build /workspace/managed/worker/build /app/managed/worker/build
COPY --from=build /workspace/package.json /app/package.json
COPY --from=build /workspace/package-lock.json /app/package-lock.json
COPY --from=build /workspace/api/package.json /app/api/package.json
COPY --from=build /workspace/ui/package.json /app/ui/package.json
COPY --from=build /workspace/managed/shared/package.json /app/managed/shared/package.json
COPY --from=build /workspace/managed/worker/package.json /app/managed/worker/package.json
COPY --from=build /workspace/runtime-source-manifest.json /app/managed/runtime-source-manifest.json
COPY --from=production-audit-input /production-dependency-audit.json /app/managed/production-dependency-audit.json
COPY LICENSE /licenses/steel-browser/LICENSE
COPY managed/worker/image/NOTICE /licenses/steel-browser/NOTICE
COPY managed/worker/image/SOURCE.json /licenses/steel-browser/SOURCE.json
COPY managed/worker/image/upstream-image.lock.json /licenses/steel-browser/upstream-image.lock.json

RUN node --input-type=module -e 'await import("file:///app/managed/shared/build/index.js")'
RUN test "$(sha256sum /app/managed/production-dependency-audit.json | cut -d ' ' -f 1)" = "${MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256}"

FROM scratch AS production

ARG MANAGED_SOURCE_REVISION
ARG MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256
ARG SOURCE_DATE_EPOCH

COPY --from=prepared / /

LABEL org.opencontainers.image.title="Happycastle Steel managed worker" \
      org.opencontainers.image.description="Private non-root Steel worker supervisor" \
      org.opencontainers.image.source="https://github.com/happycastle114/steel-browser" \
      org.opencontainers.image.url="https://github.com/happycastle114/steel-browser" \
      org.opencontainers.image.documentation="https://github.com/happycastle114/steel-browser/tree/managed/managed/worker" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.revision="${MANAGED_SOURCE_REVISION}" \
      dev.happycastle.steel.source-date-epoch="${SOURCE_DATE_EPOCH}" \
      dev.happycastle.steel.production-audit.sha256="${MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256}" \
      org.opencontainers.image.base.name="ghcr.io/steel-dev/steel-browser@sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d" \
      dev.happycastle.steel.upstream.revision="c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2" \
      dev.happycastle.steel.browser.version-proof="RUNTIME_READBACK_REQUIRED" \
      dev.happycastle.steel.worker.memory-current-max="671088640" \
      dev.happycastle.steel.worker.memory-limit="2684354560" \
      dev.happycastle.steel.worker.memory-reservation="1342177280" \
      dev.happycastle.steel.worker.shm="536870912" \
      dev.happycastle.steel.worker.tmpfs./run/steel="67108864" \
      dev.happycastle.steel.worker.tmpfs./tmp="268435456" \
      dev.happycastle.steel.worker.tmpfs./var/lib/steel/profile="268435456"

ENV NODE_ENV="production" \
    HOME="/tmp/home" \
    TMPDIR="/tmp" \
    XDG_RUNTIME_DIR="/run/steel/runtime" \
    CHROME_BIN="/usr/bin/chromium" \
    CHROME_PATH="/usr/bin/chromium" \
    CHROME_USER_DATA_DIR="/var/lib/steel/profile" \
    PATH="/usr/local/bin:/usr/bin:/bin"

WORKDIR /app
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=90s --retries=3 CMD ["node", "/app/managed/worker/build/healthcheck.js"]
ENTRYPOINT ["node", "/app/managed/worker/build/cli.js"]
