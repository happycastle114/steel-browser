import { PoolIdSchema, type PoolId } from "@happycastle/steel-managed-shared"
import type { ManagerConfigInput } from "../src/config.js"

export function validManagerConfigInput(): ManagerConfigInput {
  return {
    controlPlane: {
      managerBaseP95Bytes: 100_000_000,
      accessIssuer: "https://team.cloudflareaccess.com",
      accessAudience: "steel-audience",
      operatorServicePrincipals: ["operator-service"],
    },
    publicEndpoints: [
      {
        host: "steel-candidate.example.com",
        origin: "https://steel-candidate.example.com",
        role: "CANDIDATE",
      },
      {
        host: "steel.example.com",
        origin: "https://steel.example.com",
        role: "PRODUCTION",
      },
    ],
    schemaVersion: 1,
  }
}

export function validPoolId(): PoolId {
  return PoolIdSchema.parse("managed-blue-pool")
}
