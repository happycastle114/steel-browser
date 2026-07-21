FROM docker.io/library/node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS build

WORKDIR /workspace
COPY . .
RUN npm pkg set scripts.prepare="echo skip-husky" && npm ci --include=dev --workspace=api && npm run build -w api

FROM ghcr.io/steel-dev/steel-browser@sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d

COPY --from=build /workspace/package.json /workspace/package-lock.json /app/
COPY --from=build /workspace/node_modules /app/node_modules
COPY --from=build /workspace/api /app/api
