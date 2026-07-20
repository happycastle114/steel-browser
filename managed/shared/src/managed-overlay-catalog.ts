export const OVERLAY_DESCRIPTOR_PATH = "managed/overlay/descriptor.json"

export const OVERLAY_KIND = {
  STEEL_MANAGED_OVERLAY: "STEEL_MANAGED_OVERLAY",
} as const

export const OVERLAY_BINDING = {
  BIND_PARENT_PLAN: "BIND_PARENT_PLAN",
} as const

export const SUPERSESSION_MODE = {
  RETAIN: "RETAIN",
  AMEND: "AMEND",
  REPLACE: "REPLACE",
} as const

export const REVIEW_MERGE_METHOD = {
  MERGE: "merge",
} as const

export const REVIEW_STEP = {
  PUSH_FEATURE: "PUSH_FEATURE",
  OPEN_SECONDARY_AUTHORED_PR: "OPEN_SECONDARY_AUTHORED_PR",
  RESTORE_PRIMARY_AUTH: "RESTORE_PRIMARY_AUTH",
  INDEPENDENT_REVIEW: "INDEPENDENT_REVIEW",
  CODE_OWNER_APPROVAL: "CODE_OWNER_APPROVAL",
  MERGE: "MERGE",
} as const

export const REVIEW_ACTOR = {
  PRIMARY_CODE_OWNER: "happycastle114",
  SECONDARY_PR_AUTHOR: "soungminsonus-art",
  INDEPENDENT_REVIEWER: "INDEPENDENT_REVIEWER",
} as const

export const FIXTURE_EVALUATION_STATUS = {
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
} as const

export const VERIFICATION_STATUS = {
  VERIFIED: "VERIFIED",
} as const

export const OVERLAY_FIXTURE = {
  WRONG_PARENT_SHA: "WRONG_PARENT_SHA",
  MISSING_SUPERSESSION: "MISSING_SUPERSESSION",
  WRONG_CORPUS: "WRONG_CORPUS",
  MISSING_SECONDARY_PR_AUTHOR: "MISSING_SECONDARY_PR_AUTHOR",
  MISSING_CODEOWNER_APPROVAL: "MISSING_CODEOWNER_APPROVAL",
} as const

export const OVERLAY_FIXTURE_KIND = {
  DESCRIPTOR: "DESCRIPTOR",
  LINEAGE: "LINEAGE",
} as const

export const OVERLAY_LINEAGE_FIXTURE = {
  DIRTY_UNSTAGED: "DIRTY_UNSTAGED",
  DIRTY_INDEX: "DIRTY_INDEX",
  INTERMEDIATE_HEAD: "INTERMEDIATE_HEAD",
  MERGE_HEAD: "MERGE_HEAD",
} as const

export const DISCOVERY_MODE = {
  STATIC_CONFIG: "STATIC_CONFIG",
} as const

export const COOLIFY_CUTOVER_MODE = {
  SERIAL_MAINTENANCE: "SERIAL_MAINTENANCE",
} as const

export const COOLIFY_COMPOSE_DEPLOYMENT_MODE = {
  RAW_EXPLICIT_PROXY: "RAW_EXPLICIT_PROXY",
} as const

export const COOLIFY_SECRET_ISOLATION_MODE = {
  RAW_COMPOSE_MANAGER_SECRET: "RAW_COMPOSE_MANAGER_SECRET",
} as const

export const LEGACY_QUIESCENCE_MODE = {
  MAINTENANCE_NO_ORIGIN: "MAINTENANCE_NO_ORIGIN",
} as const

export const SUPERSESSION_DOMAIN = {
  SCOPE: "SCOPE",
  DEPENDENCY: "DEPENDENCY",
  HISTORICAL_EVIDENCE: "HISTORICAL_EVIDENCE",
} as const

export const OVERLAY_ERROR_CODE = {
  DESCRIPTOR_SCHEMA: "DESCRIPTOR_SCHEMA",
  OVERLAY_PLAN_SHA_DRIFT: "OVERLAY_PLAN_SHA_DRIFT",
  PARENT_PLAN_SHA_DRIFT: "PARENT_PLAN_SHA_DRIFT",
  CORPUS_COMMIT_DRIFT: "CORPUS_COMMIT_DRIFT",
  CORPUS_DIGEST_DRIFT: "CORPUS_DIGEST_DRIFT",
  SUPERSESSION_COVERAGE: "SUPERSESSION_COVERAGE",
  DEPENDENCY_COVERAGE: "DEPENDENCY_COVERAGE",
  REVIEW_SECONDARY_AUTHOR: "REVIEW_SECONDARY_AUTHOR",
  REVIEW_CODEOWNER_APPROVAL: "REVIEW_CODEOWNER_APPROVAL",
  REVIEW_POLICY_DRIFT: "REVIEW_POLICY_DRIFT",
  GUARDRAIL_DRIFT: "GUARDRAIL_DRIFT",
  DIRTY_WORKTREE: "DIRTY_WORKTREE",
  DIRTY_INDEX: "DIRTY_INDEX",
  INVALID_PARENT_COUNT: "INVALID_PARENT_COUNT",
  INVALID_DIRECT_PARENT: "INVALID_DIRECT_PARENT",
  UNCOMMITTED_OVERLAY: "UNCOMMITTED_OVERLAY",
  BASE_ANCESTRY_DRIFT: "BASE_ANCESTRY_DRIFT",
  LOCK_STAGE_DRIFT: "LOCK_STAGE_DRIFT",
  LOCK_DIGEST_DRIFT: "LOCK_DIGEST_DRIFT",
  FIXTURE_UNEXPECTED_ACCEPTANCE: "FIXTURE_UNEXPECTED_ACCEPTANCE",
  VERIFICATION_MISMATCH: "VERIFICATION_MISMATCH",
} as const

export const EXPECTED_OVERLAY_ID = "steel-managed-coolify-cold-standby"
export const EXPECTED_OVERLAY_PLAN_FILE = "steel-managed-coolify-cold-standby.md"
export const EXPECTED_OVERLAY_PLAN_SHA256 =
  "59741c139f72593a88d192081fdbabbae05bebf5704d8c4e7ebda03eaa6627ed"
export const EXPECTED_PARENT_PLAN_FILE = "steel-managed-control-plane.md"
export const EXPECTED_PARENT_PLAN_SHA256 =
  "93728f1ff5c1b45eaf78437845538537a0ce5e90100b52fb6f936384181d34e1"
export const EXPECTED_CORPUS_COMMIT = "83509fc93066d9b62b5aae2b63f208d9a2bc6d6a"
export const EXPECTED_MANAGED_BASE_COMMIT = "305a6f3c22a291c6eb8804ad6a0e9b7ce36a5e77"
export const EXPECTED_UPSTREAM_SHA = "c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2"
export const EXPECTED_PROTOCOL_CORPUS_SHA256 =
  "894a353443fddb123650f1e5056bcfa9a089100cd5b1838668711ad0d258a919"
export const EXPECTED_SESSION_VERDICT_SHA256 =
  "2f5d5fae8ee00725beee4dce6962be79652c167d3bbcbc38333c6d64054257c3"
export const EXPECTED_OBSERVED_RECEIPT_SHA256 =
  "476d73479c68aa30e77124c217db62f62bab93025fcae7511798f79b6a6df484"

export const EXPECTED_REVIEW_SEQUENCE = [
  { step: REVIEW_STEP.PUSH_FEATURE, actor: REVIEW_ACTOR.PRIMARY_CODE_OWNER },
  { step: REVIEW_STEP.OPEN_SECONDARY_AUTHORED_PR, actor: REVIEW_ACTOR.SECONDARY_PR_AUTHOR },
  { step: REVIEW_STEP.RESTORE_PRIMARY_AUTH, actor: REVIEW_ACTOR.PRIMARY_CODE_OWNER },
  { step: REVIEW_STEP.INDEPENDENT_REVIEW, actor: REVIEW_ACTOR.INDEPENDENT_REVIEWER },
  { step: REVIEW_STEP.CODE_OWNER_APPROVAL, actor: REVIEW_ACTOR.PRIMARY_CODE_OWNER },
  { step: REVIEW_STEP.MERGE, actor: REVIEW_ACTOR.PRIMARY_CODE_OWNER },
] as const

export const OVERLAY_ENUMS = {
  ManagedProjectRuntimeState: ["ACTIVE", "COLD_STANDBY", "STOPPED_FAILED"],
  LegacyRuntimeState: ["ACTIVE", "STOPPED_ROLLBACK", "STOPPED_FAILED"],
  DeploymentCapacityStatus: ["UNVERIFIED_UNTIL_TASK_41", "VERIFIED", "BLOCKED_COOLIFY_CAPACITY"],
  CapacityGateOutcome: ["VERIFIED", "BLOCKED_MEMORY", "BLOCKED_CPU", "BLOCKED_DISK", "BLOCKED_INODES", "BLOCKED_SHM_TMPFS", "BLOCKED_PRESSURE", "BLOCKED_MEASUREMENT"],
  DeploymentGateOutcome: ["VERIFIED", "BLOCKED_COOLIFY_CAPACITY", "BLOCKED_SECRET_RUNTIME", "BLOCKED_NO_SAFE_TARGET", "BLOCKED_COOLIFY_OPERATION", "BLOCKED_ROUTE_OWNERSHIP"],
  CoolifyCutoverMode: ["SERIAL_MAINTENANCE"],
  CoolifyOperatorSurface: ["API", "AUTHENTICATED_SERVER_TERMINAL"],
  CoolifyComposeDeploymentMode: ["RAW_EXPLICIT_PROXY"],
  CoolifySecretIsolationMode: ["RAW_COMPOSE_MANAGER_SECRET"],
  LegacyQuiescenceMode: ["MAINTENANCE_NO_ORIGIN"],
  EdgeRouteMode: ["COOLIFY_PROXY", "MAINTENANCE"],
  CoolifyProductionOwner: ["LEGACY", "MANAGED_BLUE", "MANAGED_GREEN", "NONE"],
  SteelServingTarget: ["LEGACY", "MANAGED_BLUE", "MANAGED_GREEN", "MAINTENANCE"],
  CompositeRoutePhase: ["PROXY_CURRENT_OWNER", "MAINTENANCE_OLD_OWNER", "MAINTENANCE_NO_OWNER", "MAINTENANCE_NEW_OWNER"],
  FingerprintProofLevel: ["CONFIG_BOUND", "RUNTIME_VERIFIED"],
  CoolifySchemaEvidence: ["OPENAPI", "PINNED_SOURCE_EXCEPTION"],
  SecretBackupOperation: ["READ_CANONICAL", "CREATE_CANONICAL", "WRITE_APP", "RESTORE_STOPPED_APP", "VERIFY_FINGERPRINT"],
  CoolifyOperationKind: ["READ_COOLIFY_VERSION", "READ_OPENAPI", "READ_PROJECT", "READ_ENVIRONMENT", "READ_SERVER", "READ_DESTINATIONS", "DISCOVER", "CREATE", "DELETE_APPLICATION", "UPDATE_CONFIG", "READ_ENVS", "CREATE_ENV", "UPDATE_ENV", "START", "STOP", "READ_DEPLOYMENT", "READ_APPLICATION", "READ_PROXY_OWNER", "VERIFY_STOPPED"],
  CoolifyDeploymentStatus: ["QUEUED", "IN_PROGRESS", "FINISHED", "FAILED", "CANCELLED", "UNKNOWN"],
  CoolifyOperationState: ["REQUEST_QUEUED", "TERMINAL_SUCCESS", "TERMINAL_FAILURE", "UNKNOWN"],
  SecretProvisioningState: ["BOTH_ABSENT", "CANONICAL_KEY_AVAILABLE", "WRITE_BLUE_CONFIRMED", "WRITE_GREEN_CONFIRMED", "CONFIG_RECEIPTS_MATCH", "RUNTIME_FINGERPRINT_MATCH", "PARTIAL_WRITE_RECOVERY", "ROTATION_REQUIRED", "BLOCKED_NO_CANONICAL_KEY"],
  ManagedHandoverState: ["ACTIVE_DRAIN_SAFE", "EDGE_MAINTENANCE", "ACTIVE_STOPPED", "DOMAIN_NONE", "STANDBY_CONFIG_BOUND", "STANDBY_STARTED", "STANDBY_RUNTIME_VERIFIED", "DOMAIN_STANDBY", "STANDBY_SERVING", "EDGE_COOLIFY_PROXY"],
} as const satisfies Readonly<Record<string, readonly string[]>>

export type SupersessionExpectation = Readonly<{
  readonly parentItem: string
  readonly mode: (typeof SUPERSESSION_MODE)[keyof typeof SUPERSESSION_MODE]
  readonly authority: string
  readonly modeDomain: (typeof SUPERSESSION_DOMAIN)[keyof typeof SUPERSESSION_DOMAIN]
  readonly secondaryModes: readonly Readonly<{
    readonly domain: (typeof SUPERSESSION_DOMAIN)[keyof typeof SUPERSESSION_DOMAIN]
    readonly mode: (typeof SUPERSESSION_MODE)[keyof typeof SUPERSESSION_MODE]
    readonly tasks?: readonly string[]
  }>[]
}>

export const EXPECTED_SUPERSESSION: readonly SupersessionExpectation[] = [
  { parentItem: "C1-C6, Tasks 1,3,5", mode: SUPERSESSION_MODE.RETAIN, authority: "parent-scope-and-evidence", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 2", mode: SUPERSESSION_MODE.REPLACE, authority: "overlay-todo-9-capacity-and-identity-gate", modeDomain: SUPERSESSION_DOMAIN.DEPENDENCY, secondaryModes: [{ domain: SUPERSESSION_DOMAIN.HISTORICAL_EVIDENCE, mode: SUPERSESSION_MODE.RETAIN }] },
  { parentItem: "Parent legacy quiescence oracle/config (frozen parent lines 115,154; Task 2/43/44 request-counter clauses)", mode: SUPERSESSION_MODE.REPLACE, authority: "maintenance-no-origin-and-terminal-socket-oracle", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Parent Coolify configuration backup/restore clause (frozen parent lines 152 and Task 41)", mode: SUPERSESSION_MODE.REPLACE, authority: "keychain-canonical-no-secret-receipts", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 4", mode: SUPERSESSION_MODE.REPLACE, authority: "static-two-worker-fixtures", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 6", mode: SUPERSESSION_MODE.REPLACE, authority: "overlay-scope-certification", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Parent configuration clause: worker count formula (frozen parent line 76)", mode: SUPERSESSION_MODE.REPLACE, authority: "exactly-two-active-workers", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Parent configuration clause: manager cardinality (frozen parent line 79)", mode: SUPERSESSION_MODE.REPLACE, authority: "single-active-manager", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Parent manager image/secret startup clauses (frozen parent line 107 and Task 23)", mode: SUPERSESSION_MODE.AMEND, authority: "root-init-then-non-root-manager", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 7", mode: SUPERSESSION_MODE.AMEND, authority: "state-machine-dependencies-overlay-todos-2-3", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Tasks 8-23", mode: SUPERSESSION_MODE.RETAIN, authority: "parent-product-contracts-overlay-dependencies", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [{ domain: SUPERSESSION_DOMAIN.DEPENDENCY, mode: SUPERSESSION_MODE.AMEND, tasks: ["8", "10", "22"] }] },
  { parentItem: "Task 24", mode: SUPERSESSION_MODE.REPLACE, authority: "active-and-cold-standby-compose", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 25", mode: SUPERSESSION_MODE.AMEND, authority: "single-active-and-raw-secret-fixtures", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Tasks 26-30", mode: SUPERSESSION_MODE.RETAIN, authority: "parent-ui-visual-security-runbook", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 31", mode: SUPERSESSION_MODE.AMEND, authority: "overlay-compose-controller-policy-inputs", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 32", mode: SUPERSESSION_MODE.REPLACE, authority: "coolify-proxy-maintenance-route-lineage", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 33", mode: SUPERSESSION_MODE.AMEND, authority: "serialized-coolify-lifecycle-commands", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Tasks 34-35", mode: SUPERSESSION_MODE.AMEND, authority: "two-worker-warm-idle-receipt", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Tasks 36-40", mode: SUPERSESSION_MODE.AMEND, authority: "single-active-exact-rc-evidence", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Parent handover clause (frozen parent line 146)", mode: SUPERSESSION_MODE.REPLACE, authority: "zero-overlap-handover", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Parent exact Coolify topology/bootstrap/rollback clauses (frozen parent lines 149-155)", mode: SUPERSESSION_MODE.REPLACE, authority: "coolify-topology-and-rollback", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 41", mode: SUPERSESSION_MODE.REPLACE, authority: "stopped-config-bound-live-gate", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Tasks 42-43", mode: SUPERSESSION_MODE.REPLACE, authority: "maintenance-cutover-rollback-repromotion", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Task 44", mode: SUPERSESSION_MODE.REPLACE, authority: "production-handover-and-publication", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "F1-F4", mode: SUPERSESSION_MODE.AMEND, authority: "overlay-review-gates", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "P1", mode: SUPERSESSION_MODE.REPLACE, authority: "post-acceptance-preserve-rollback", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
  { parentItem: "Every parent item not listed above", mode: SUPERSESSION_MODE.RETAIN, authority: "no-implicit-supersession", modeDomain: SUPERSESSION_DOMAIN.SCOPE, secondaryModes: [] },
]

export type DependencyExpectation = Readonly<{
  readonly todo: string
  readonly dependsOn: readonly string[]
  readonly blocks: readonly string[]
  readonly parallelWith: readonly string[]
}>

export const EXPECTED_DEPENDENCIES: readonly DependencyExpectation[] = [
  { todo: "1", dependsOn: ["verified-parent-tasks-1-3-5", "approved-overlay"], blocks: ["2", "3", "8"], parallelWith: [] },
  { todo: "2", dependsOn: ["1"], blocks: ["3", "4", "5", "7", "8"], parallelWith: [] },
  { todo: "3", dependsOn: ["1", "2"], blocks: ["4", "5", "7", "8"], parallelWith: [] },
  { todo: "4", dependsOn: ["2", "3"], blocks: ["5", "7", "8", "9"], parallelWith: ["6"] },
  { todo: "5", dependsOn: ["2", "3", "4"], blocks: ["8", "9", "10", "11"], parallelWith: ["6", "7"] },
  { todo: "6", dependsOn: ["parent-task-32-inputs", "overlay-decisions"], blocks: ["8", "9", "10", "11"], parallelWith: ["4", "5", "7"] },
  { todo: "7", dependsOn: ["2", "3", "4"], blocks: ["8", "9"], parallelWith: ["5", "6"] },
  { todo: "8", dependsOn: ["1", "2", "3", "4", "5", "6", "7"], blocks: ["9"], parallelWith: [] },
  { todo: "9", dependsOn: ["4", "5", "6", "7", "8", "parent-task-40-green"], blocks: ["10"], parallelWith: [] },
  { todo: "10", dependsOn: ["9"], blocks: ["11"], parallelWith: [] },
  { todo: "11", dependsOn: ["10"], blocks: ["12"], parallelWith: [] },
  { todo: "12", dependsOn: ["11"], blocks: ["F1-F4"], parallelWith: [] },
  { todo: "F1-F4", dependsOn: ["12-signed-review-input"], blocks: ["P1"], parallelWith: ["each-other"] },
  { todo: "P1", dependsOn: ["F1-F4-APPROVE", "explicit-user-acceptance", "cooldown"], blocks: [], parallelWith: [] },
]
