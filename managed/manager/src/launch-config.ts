import {
  PoolIdSchema,
  Sha256Schema,
  WorkerIdSchema,
  type PoolId,
  type Sha256,
  type WorkerId,
} from "@happycastle/steel-managed-shared"
import { z } from "zod"

export const MANAGER_EXECUTABLE_PATH = "/usr/local/bin/steel-managed-manager"
export const MANAGER_HEALTHCHECK_PATH = "/usr/local/bin/steel-manager-healthcheck"
export const MANAGER_INIT_PATH = "/usr/local/bin/steel-manager-init"
export const MANAGER_HEALTHCHECK_URL = "http://127.0.0.1:3001/livez"
export const MANAGER_TOKEN_KEY_PATH = "/run/steel/managed-create-token-key"
export const MANAGER_RELEASE_EVIDENCE_PATH = "/run/steel/managed-release-evidence.json"

const ManagerArgumentSchema = z.tuple([
  z.enum(["--pool-id=managed-blue-pool", "--pool-id=managed-green-pool"]),
  z.literal("--worker=worker-00=http://worker-00:3000"),
  z.literal("--worker=worker-01=http://worker-01:3000"),
  z.literal("--public-bind=0.0.0.0:3000"),
  z.literal("--health-bind=127.0.0.1:3001"),
  z.literal(`--create-token-key-file=${MANAGER_TOKEN_KEY_PATH}`),
  z.literal(`--release-evidence-file=${MANAGER_RELEASE_EVIDENCE_PATH}`),
  z.string().regex(/^--release-evidence-sha256=[0-9a-f]{64}$/u),
])

export type ManagerWorkerTarget = Readonly<{
  id: WorkerId
  origin: URL
}>

export type ManagerLaunchConfig = Readonly<{
  healthHost: "127.0.0.1"
  healthPort: 3_001
  poolId: PoolId
  publicHost: "0.0.0.0"
  publicPort: 3_000
  releaseEvidencePath: typeof MANAGER_RELEASE_EVIDENCE_PATH
  releaseEvidenceSha256: Sha256
  tokenKeyPath: typeof MANAGER_TOKEN_KEY_PATH
  workers: readonly [ManagerWorkerTarget, ManagerWorkerTarget]
}>

export function parseManagerArguments(arguments_: readonly string[]): ManagerLaunchConfig {
  const parsedArguments = ManagerArgumentSchema.parse(arguments_)
  const poolArgument = parsedArguments[0]
  const releaseEvidenceSha256Argument = parsedArguments[7]
  return Object.freeze({
    healthHost: "127.0.0.1",
    healthPort: 3_001,
    poolId: PoolIdSchema.parse(poolArgument.slice("--pool-id=".length)),
    publicHost: "0.0.0.0",
    publicPort: 3_000,
    releaseEvidencePath: MANAGER_RELEASE_EVIDENCE_PATH,
    releaseEvidenceSha256: Sha256Schema.parse(
      releaseEvidenceSha256Argument.slice("--release-evidence-sha256=".length),
    ),
    tokenKeyPath: MANAGER_TOKEN_KEY_PATH,
    workers: Object.freeze([
      Object.freeze({ id: WorkerIdSchema.parse("worker-00"), origin: new URL("http://worker-00:3000") }),
      Object.freeze({ id: WorkerIdSchema.parse("worker-01"), origin: new URL("http://worker-01:3000") }),
    ] as const),
  })
}

export function parseHealthcheckArguments(arguments_: readonly string[]): typeof MANAGER_HEALTHCHECK_URL {
  return z.tuple([z.literal(MANAGER_HEALTHCHECK_URL)]).parse(arguments_)[0]
}
