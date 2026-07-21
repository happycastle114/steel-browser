import * as ts from "typescript"

import { resolveRepositoryPath } from "./semantic-typescript-program.js"

const exportsFor = (names: readonly string[]): ReadonlySet<string> => new Set(names)
const trustedModule = (modulePath: string, names: readonly string[]): readonly [string, ReadonlySet<string>] =>
  [resolveRepositoryPath(modulePath), exportsFor(names)]

const TRUSTED_EXPORTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  trustedModule("managed/gateway/src/domain/states.ts", [
    "WorkerState", "WorkerRemoteState", "SessionState", "AdmissionState", "GatewayEventType",
    "ObservationCommitKind", "WorkerTransportReason", "ReconcileOutcome", "LifecycleCreateKind",
    "LifecycleOperation", "WorkerMutation",
    "ActionJobOutcomeKind",
  ]),
  trustedModule("managed/shared/src/bootstrap-policy.ts", [
    "WORKSPACE_PATH", "GH_IDENTITY", "FORK_RELATION", "MAIN_MIRROR", "BASE_REACHABILITY",
    "MANAGED_BRANCH", "BOOTSTRAP_DECISION", "BOOTSTRAP_ACTION", "BOOTSTRAP_BLOCK_CODE",
  ]),
  trustedModule("managed/shared/src/control-plane-vocabulary.ts", [
    "MANAGER_MODE", "HANDOVER_MODE", "MANAGER_MODE_CAUSE", "EMERGENCY_RECOVERY_STATE",
    "PRINCIPAL_KIND", "PRINCIPAL_ROLE", "FINGERPRINT_BINDING_STAGE", "IDEMPOTENCY_SCOPE",
    "CONTROL_PLANE_SESSION_ID_MODE", "CREATE_JOURNAL_STATE", "CREATE_REPLAY_STATE", "WORKER_STATE",
    "SESSION_STATE", "ADMISSION_STATE", "EVENT_TYPE", "LEGACY_BOOTSTRAP_STATE", "RESULT_KIND",
    "TOOL_MUTABILITY", "TOOL_SESSION_REQUIREMENT", "TOOL_OUTPUT_POLICY", "STEEL_ROUTE_TARGET",
    "CREATE_RECOVERY_OUTCOME", "INSTANCE_LOST_REASON", "MANAGER_MODE_TRANSITION",
    "CREATE_REPLAY_TEMPLATE_KIND",
  ]),
  trustedModule("managed/shared/src/create-replay-contract.ts", ["PUBLIC_URL_KIND"]),
  trustedModule("managed/shared/src/deployment-listener-vocabulary.ts", [
    "MANAGED_LISTENER_ID", "MANAGED_LISTENER_CONTAINER_ROLE", "MANAGED_LISTENER_ROLE",
    "MANAGED_LISTENER_BIND_SCOPE", "MANAGED_LISTENER_PUBLICATION",
  ]),
  trustedModule("managed/shared/src/deployment-vocabulary.ts", [
    "MANAGED_PROJECT_RUNTIME_STATE", "LEGACY_RUNTIME_STATE", "DEPLOYMENT_CAPACITY_STATUS",
    "CAPACITY_GATE_OUTCOME", "DEPLOYMENT_GATE_OUTCOME", "CAPACITY_PHASE", "DISK_CAPACITY_STAGE",
    "INODE_CAPACITY_STAGE", "DISCOVERY_MODE", "COOLIFY_CUTOVER_MODE", "COOLIFY_OPERATOR_SURFACE",
    "COOLIFY_COMPOSE_DEPLOYMENT_MODE", "COOLIFY_SECRET_ISOLATION_MODE", "LEGACY_QUIESCENCE_MODE",
    "EDGE_ROUTE_MODE", "COOLIFY_PRODUCTION_OWNER", "STEEL_SERVING_TARGET", "COMPOSITE_ROUTE_PHASE",
    "FINGERPRINT_PROOF_LEVEL", "COOLIFY_SCHEMA_EVIDENCE", "SECRET_BACKUP_OPERATION",
    "COOLIFY_OPERATION_KIND", "COOLIFY_DEPLOYMENT_STATUS", "COOLIFY_OPERATION_STATE",
    "SECRET_PROVISIONING_STATE", "MANAGED_HANDOVER_STATE",
  ]),
  trustedModule("managed/shared/src/deployment-vocabulary-values.ts", [
    "MANAGED_PROJECT_RUNTIME_STATE", "LEGACY_RUNTIME_STATE", "DEPLOYMENT_CAPACITY_STATUS",
    "CAPACITY_GATE_OUTCOME", "DEPLOYMENT_GATE_OUTCOME", "CAPACITY_PHASE", "DISK_CAPACITY_STAGE",
    "INODE_CAPACITY_STAGE", "DISCOVERY_MODE", "COOLIFY_CUTOVER_MODE", "COOLIFY_OPERATOR_SURFACE",
    "COOLIFY_COMPOSE_DEPLOYMENT_MODE", "COOLIFY_SECRET_ISOLATION_MODE", "LEGACY_QUIESCENCE_MODE",
    "EDGE_ROUTE_MODE", "COOLIFY_PRODUCTION_OWNER", "STEEL_SERVING_TARGET", "COMPOSITE_ROUTE_PHASE",
    "FINGERPRINT_PROOF_LEVEL", "COOLIFY_SCHEMA_EVIDENCE", "SECRET_BACKUP_OPERATION",
    "COOLIFY_OPERATION_KIND", "COOLIFY_DEPLOYMENT_STATUS", "COOLIFY_OPERATION_STATE",
    "SECRET_PROVISIONING_STATE", "MANAGED_HANDOVER_STATE",
  ]),
  trustedModule("managed/shared/src/managed-overlay-catalog.ts", [
    "OVERLAY_KIND", "OVERLAY_BINDING", "SUPERSESSION_MODE", "REVIEW_MERGE_METHOD", "REVIEW_STEP",
    "REVIEW_ACTOR", "FIXTURE_EVALUATION_STATUS", "VERIFICATION_STATUS", "OVERLAY_FIXTURE",
    "OVERLAY_FIXTURE_KIND", "OVERLAY_LINEAGE_FIXTURE", "SUPERSESSION_DOMAIN", "OVERLAY_ERROR_CODE",
  ]),
  trustedModule("managed/shared/src/manager-init-vocabulary.ts", [
    "MANAGER_INIT_VERIFICATION_SURFACE", "MANAGER_INIT_PLATFORM", "MANAGER_INIT_MOUNT_EVIDENCE_SOURCE",
    "MANAGER_INIT_DESTINATION_MOUNT", "MANAGER_INIT_MOUNT_FLAG", "MANAGER_INIT_EXECUTION_RECEIPT_KIND",
    "MANAGER_INIT_CLEANUP_STATUS", "MANAGER_INIT_VERIFICATION_RESULT_KIND", "MANAGER_INIT_FD_TARGET_CLASS",
    "MANAGER_INIT_DESCRIPTOR_KIND", "MANAGER_INIT_OPEN_FLAG", "MANAGER_LINUX_CAPABILITY",
    "MANAGER_STATUS_CAP_FIELD", "MANAGER_INIT_STEP", "MANAGER_INIT_ERROR_CODE",
  ]),
  trustedModule("managed/shared/src/retry-after.ts", [
    "RETRY_AFTER_REASON", "RETRY_POLICY_CAUSE", "AI_RESULT_CAPACITY_STATE",
  ]),
  trustedModule("managed/shared/src/result-reservation-contract.ts", [
    "RESULT_RESERVATION_STATE", "RESULT_RESERVATION_OUTCOME", "RESULT_PREPARE_OUTCOME",
    "RESULT_COMMIT_OUTCOME", "RESULT_COMMIT_REJECTION_REASON", "RESULT_FAILURE_RELEASE_REASON",
    "RESULT_FAILURE_RELEASE_OUTCOME", "RESULT_RESERVATION_AUDIT_REASON",
    "RESULT_RETAINED_QUARANTINE_OUTCOME",
  ]),
  trustedModule("managed/shared/src/runtime-scope-fixture-vocabulary.ts", [
    "COOLIFY_SECRET_FIXTURE_MODE", "COOLIFY_SECRET_FIXTURE_SEQUENCE", "RUNTIME_SCOPE_MUTATION",
    "RUNTIME_SCOPE_MUTATION_STATUS",
  ]),
  trustedModule("managed/shared/src/upstream-corpus-model.ts", [
    "PROTOCOL_KIND", "HTTP_METHOD", "AFFINITY_RULE", "LIFECYCLE_CLASS", "SESSION_ID_MODE",
    "CREATE_JOURNAL_BINDING", "WEBSOCKET_UPGRADE_CLASS", "WEBSOCKET_MESSAGE_KIND",
    "WEBSOCKET_MESSAGE_BY_UPGRADE", "RUNTIME_CONDITION", "BODY_KIND",
  ]),
  trustedModule("managed/shared/src/upstream-corpus-vocabulary-values.ts", [
    "PROTOCOL_KIND", "HTTP_METHOD", "AFFINITY_RULE", "LIFECYCLE_CLASS", "SESSION_ID_MODE",
    "CREATE_JOURNAL_BINDING", "WEBSOCKET_UPGRADE_CLASS", "WEBSOCKET_MESSAGE_KIND",
    "WEBSOCKET_MESSAGE_BY_UPGRADE", "RUNTIME_CONDITION", "BODY_KIND",
  ]),
  trustedModule("managed/shared/src/upstream-lock.ts", ["LOCK_STAGE"]),
])

function owningVariable(declaration: ts.Declaration): ts.VariableDeclaration | undefined {
  let current: ts.Node | undefined = declaration
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current)) return current
    current = current.parent
  }
  return undefined
}

export function isTrustedVocabularyDeclaration(declaration: ts.Declaration): boolean {
  const variable = owningVariable(declaration)
  if (variable === undefined || !ts.isIdentifier(variable.name)) return false
  const declarationList = variable.parent
  const statement = declarationList.parent
  if (!ts.isVariableDeclarationList(declarationList) || !ts.isVariableStatement(statement)) return false
  const isConst = (declarationList.flags & ts.NodeFlags.Const) !== 0
  const isExported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  const moduleExports = TRUSTED_EXPORTS.get(resolveRepositoryPath(declaration.getSourceFile().fileName))
  return isConst && isExported && moduleExports?.has(variable.name.text) === true
}
