import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto"
import type { RsaJwk } from "../src/auth/jwks-key-store.js"

export type SigningFixture = {
  readonly jwk: RsaJwk
  readonly privateKey: KeyObject
}

export function signingFixture(kid: string, modulusLength = 2_048): SigningFixture {
  const pair = generateKeyPairSync("rsa", { modulusLength })
  const exported = pair.publicKey.export({ format: "jwk" })
  if (exported.kty !== "RSA" || typeof exported.e !== "string" || typeof exported.n !== "string") {
    throw new TypeError("test key was not a complete RSA key")
  }
  return {
    jwk: {
      alg: "RS256",
      e: exported.e,
      kid,
      kty: "RSA",
      n: exported.n,
      notAfterMilliseconds: 2_000_000_000_000,
      use: "sig",
    },
    privateKey: createPrivateKey(pair.privateKey.export({ format: "pem", type: "pkcs8" })),
  }
}

export function signedJwt(input: {
  readonly kid: string
  readonly privateKey: KeyObject
  readonly claims?: Readonly<Record<string, unknown>>
}): string {
  const now = 1_800_000_000
  const header = encodeJson({ alg: "RS256", kid: input.kid, typ: "JWT" })
  const payload = encodeJson({
    iss: "https://team.cloudflareaccess.com",
    type: "app",
    aud: ["steel-audience"],
    sub: "user@example.com",
    iat: now - 10,
    nbf: now - 10,
    exp: now + 300,
    ...input.claims,
  })
  const signingInput = `${header}.${payload}`
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), input.privateKey).toString(
    "base64url",
  )
  return `${signingInput}.${signature}`
}

function encodeJson(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}
