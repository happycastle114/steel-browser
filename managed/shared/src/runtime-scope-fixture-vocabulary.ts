export const COOLIFY_SECRET_FIXTURE_MODE = {
  RAW_COMPOSE_MANAGER_SECRET: "RAW_COMPOSE_MANAGER_SECRET",
} as const

export const COOLIFY_SECRET_FIXTURE_SEQUENCE = {
  BLUE_THEN_GREEN: "BLUE_THEN_GREEN",
} as const

export const RUNTIME_SCOPE_MUTATION = {
  REPLICA_DNS: "replica-dns",
  WORKER_OVERLAP: "worker-overlap",
  WORKER_SECRET: "worker-secret",
  SECRET_ENV: "secret-env",
  PARSED_COMPOSE: "parsed-compose",
  NONROOT_INIT: "nonroot-init",
  SOURCE_DIR_TRAVERSABLE: "source-dir-traversable",
  MISSING_CLOEXEC: "missing-cloexec",
  INHERITED_SOURCE_FD: "inherited-source-fd",
  INHERITED_DESTINATION_FD: "inherited-destination-fd",
  MISSING_SETPCAP: "missing-setpcap",
  WRONG_DROP_ORDER: "wrong-drop-order",
  NONZERO_CAPINH: "nonzero-capinh",
  NONZERO_CAPPRM: "nonzero-capprm",
  NONZERO_CAPEFF: "nonzero-capeff",
  NONZERO_CAPBND: "nonzero-capbnd",
  NONZERO_CAPAMB: "nonzero-capamb",
  SUPPLEMENTARY_GROUP: "supplementary-group",
  NO_NEW_PRIVS: "no-new-privs",
  STOPPED_RUNTIME_PROOF: "stopped-runtime-proof",
  STALE_OVERLAY: "stale-overlay",
  LIVE_CAPACITY_CLAIM: "live-capacity-claim",
} as const

export const RUNTIME_SCOPE_MUTATION_STATUS = {
  REJECTED: "REJECTED",
} as const
