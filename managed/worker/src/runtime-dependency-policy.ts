export const WORKER_RUNTIME_DEPENDENCY = {
  GRAPH: "SELECTED_WORKSPACES",
  INSTALL:
    "RUN npm ci --ignore-scripts --omit=dev --workspace @steel-browser/api --workspace @happycastle/steel-managed-shared --workspace @happycastle/steel-managed-worker --include-workspace-root=false",
  NATIVE_OVERLAYS: [
    "COPY --from=build /workspace/node_modules/classic-level /workspace/node_modules/classic-level",
    "COPY --from=build /workspace/node_modules/duckdb /workspace/node_modules/duckdb",
    "COPY --from=build /workspace/node_modules/classic-level /runtime-deps/node_modules/classic-level",
    "COPY --from=build /workspace/node_modules/duckdb /runtime-deps/node_modules/duckdb",
  ],
} as const
