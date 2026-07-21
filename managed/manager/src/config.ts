import { createHash } from "node:crypto"
import { isIP } from "node:net"
import path from "node:path"
import {
  parseControlPlaneConfig,
  type ControlPlaneConfig,
  type ControlPlaneConfigInput,
  type PoolId,
} from "@happycastle/steel-managed-shared"
import { z } from "zod"

export const MANAGER_CONFIG_ENVIRONMENT_KEY = "STEEL_MANAGED_CONFIG_JSON"
export const MANAGER_UI_ASSET_ROOT = "/srv/steel-console"
const MANAGER_CONFIG_BYTES_MAX = 262_144

export const ManagerPublicEndpointRole = {
  CANDIDATE: "CANDIDATE",
  PRODUCTION: "PRODUCTION",
} as const

const ManagerPublicEndpointRoleSchema = z.enum([
  ManagerPublicEndpointRole.CANDIDATE,
  ManagerPublicEndpointRole.PRODUCTION,
])
const PublicHostnameSchema = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u)
  .refine((value) => isIP(value) === 0, "public endpoint Host must not be an IP address")
  .refine(
    (value) => ![".home.arpa", ".internal", ".local", ".localhost"].some((suffix) => value.endsWith(suffix)),
    "public endpoint Host must not use a private suffix",
  )
const ManagerPublicEndpointSchema = z
  .object({
    host: PublicHostnameSchema,
    origin: z.string().url(),
    role: ManagerPublicEndpointRoleSchema,
  })
  .strict()
  .superRefine((endpoint, context) => {
    if (endpoint.origin !== `https://${endpoint.host}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "public endpoint origin must be exact host-only HTTPS",
      })
    }
  })
  .readonly()

const ManagerConfigEnvelopeSchema = z
  .object({
    controlPlane: z
      .record(z.unknown())
      .refine(
        (value) =>
          !["allowedHosts", "poolId", "publicOriginByHost"].some((key) => Object.hasOwn(value, key)),
        "launch and public endpoint values must have one source of truth",
      ),
    publicEndpoints: z.array(ManagerPublicEndpointSchema).length(2),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((envelope, context) => {
    const roles = new Set(envelope.publicEndpoints.map((endpoint) => endpoint.role))
    const hosts = new Set(envelope.publicEndpoints.map((endpoint) => endpoint.host))
    if (roles.size !== 2 || hosts.size !== 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "candidate and production endpoints must have distinct roles and Hosts",
      })
    }
  })
  .readonly()

export type ManagerConfigInput = {
  readonly controlPlane: Omit<
    ControlPlaneConfigInput,
    "allowedHosts" | "poolId" | "publicOriginByHost"
  >
  readonly publicEndpoints: readonly [
    z.input<typeof ManagerPublicEndpointSchema>,
    z.input<typeof ManagerPublicEndpointSchema>,
  ]
  readonly schemaVersion: 1
}

export type ManagerConfig = {
  readonly controlPlane: ControlPlaneConfig
  readonly publicEndpoints: readonly z.output<typeof ManagerPublicEndpointSchema>[]
  readonly uiAssetRoot: string
}

export type ManagerConfigReceipt = Readonly<{
  config: ManagerConfig
  sha256: string
}>

export const ManagerConfigurationFailure = {
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
  INVALID_JSON: "INVALID_JSON",
  MISSING_ENVIRONMENT: "MISSING_ENVIRONMENT",
} as const
type ManagerConfigurationFailure =
  (typeof ManagerConfigurationFailure)[keyof typeof ManagerConfigurationFailure]

export class ManagerConfigurationError extends Error {
  public override readonly name = "ManagerConfigurationError"

  public constructor(public readonly code: ManagerConfigurationFailure) {
    super("manager configuration rejected")
  }
}

export function parseManagerConfig(input: unknown, poolId: PoolId): ManagerConfig {
  const envelope = ManagerConfigEnvelopeSchema.parse(input)
  const allowedHosts = envelope.publicEndpoints.map((endpoint) => endpoint.host)
  const publicOriginByHost = Object.fromEntries(
    envelope.publicEndpoints.map((endpoint) => [endpoint.host, endpoint.origin]),
  )
  const controlPlane = parseControlPlaneConfig({
    ...envelope.controlPlane,
    allowedHosts,
    poolId,
    publicOriginByHost,
  })
  return Object.freeze({
    controlPlane,
    publicEndpoints: envelope.publicEndpoints,
    uiAssetRoot: path.normalize(MANAGER_UI_ASSET_ROOT),
  })
}

export function loadManagerConfig(
  environment: Readonly<Record<string, string | undefined>>,
  poolId: PoolId,
): ManagerConfig {
  return loadManagerConfigReceipt(environment, poolId).config
}

export function loadManagerConfigReceipt(
  environment: Readonly<Record<string, string | undefined>>,
  poolId: PoolId,
): ManagerConfigReceipt {
  const serialized = environment[MANAGER_CONFIG_ENVIRONMENT_KEY]
  if (serialized === undefined || serialized.length === 0) {
    throw new ManagerConfigurationError(ManagerConfigurationFailure.MISSING_ENVIRONMENT)
  }
  const bytes = Buffer.from(serialized, "utf8")
  if (
    bytes.byteLength > MANAGER_CONFIG_BYTES_MAX ||
    bytes.toString("utf8") !== serialized
  ) {
    throw new ManagerConfigurationError(ManagerConfigurationFailure.INVALID_CONFIGURATION)
  }
  try {
    return Object.freeze({
      config: parseManagerConfig(JSON.parse(serialized), poolId),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ManagerConfigurationError(ManagerConfigurationFailure.INVALID_JSON)
    }
    throw error
  }
}
