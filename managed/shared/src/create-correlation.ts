import { z } from "zod"

import { canonicalJson, type JsonValue } from "./canonical-json.js"
import {
  KeyedCreateTokenSchema,
  RandomCreateTokenSchema,
  Sha256Schema,
  UuidV4Schema,
  type CreateIdempotencyKey,
  type KeyedCreateToken,
  type PrincipalId,
  type RandomCreateToken,
  type Sha256,
} from "./control-plane-primitives.js"
import type { PrincipalKind, SessionIdMode } from "./control-plane-vocabulary.js"

const OWNER_DOMAIN = new TextEncoder().encode("steel-owner-v1")
const CREATE_DOMAIN = new TextEncoder().encode("steel-create-v1")
const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/u

const CreateTokenKeySchema = z.instanceof(Uint8Array).refine((value) => value.byteLength === 32).brand("CreateTokenKey")
export type CreateTokenKey = z.infer<typeof CreateTokenKeySchema>

export type CreateCorrelationInput = Readonly<{
  readonly key: CreateTokenKey
  readonly principalKind: PrincipalKind
  readonly principalId: PrincipalId
  readonly idempotencyKey: CreateIdempotencyKey
  readonly requestBody: JsonValue
  readonly sessionIdMode: SessionIdMode
}>

export type CreateCorrelation = Readonly<{
  readonly ownerPreimageHex: string
  readonly ownerSha256: Sha256
  readonly requestCanonical: string
  readonly requestSha256: Sha256
  readonly tokenPreimageHex: string
  readonly createToken: KeyedCreateToken
}>

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function lengthPrefix(value: Uint8Array): Uint8Array {
  const prefix = new Uint8Array(4)
  new DataView(prefix.buffer).setUint32(0, value.byteLength, false)
  return concatBytes([prefix, value])
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", value))
}

async function hmacSha256(key: CreateTokenKey, value: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", cryptoKey, value))
}

export function parseCreateTokenKey(keyHex: string): CreateTokenKey {
  if (!KEY_HEX_PATTERN.test(keyHex)) throw new TypeError("create token key must be 64 lowercase hex characters")
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = keyHex.slice(index * 2, index * 2 + 2)
    bytes[index] = Number.parseInt(pair, 16)
  }
  return CreateTokenKeySchema.parse(bytes)
}

export function buildRandomCreateToken(uuidV4: string): RandomCreateToken {
  const canonicalUuid = UuidV4Schema.parse(uuidV4)
  return RandomCreateTokenSchema.parse(`r1_${canonicalUuid}`)
}

export async function deriveCreateCorrelation(input: CreateCorrelationInput): Promise<CreateCorrelation> {
  const { key, principalKind, principalId, idempotencyKey, requestBody, sessionIdMode } = input
  const ownerPreimage = concatBytes([
    OWNER_DOMAIN,
    lengthPrefix(new TextEncoder().encode(principalKind)),
    lengthPrefix(new TextEncoder().encode(principalId)),
  ])
  const ownerDigest = await hmacSha256(key, ownerPreimage)
  const requestCanonical = canonicalJson({ body: requestBody, sessionIdMode, v: 1 })
  const requestDigest = await sha256(new TextEncoder().encode(requestCanonical))
  const tokenPreimage = concatBytes([
    CREATE_DOMAIN,
    lengthPrefix(ownerDigest),
    lengthPrefix(new TextEncoder().encode(idempotencyKey)),
  ])
  const createTokenDigest = await hmacSha256(key, tokenPreimage)
  return {
    ownerPreimageHex: bytesToHex(ownerPreimage),
    ownerSha256: Sha256Schema.parse(bytesToHex(ownerDigest)),
    requestCanonical,
    requestSha256: Sha256Schema.parse(bytesToHex(requestDigest)),
    tokenPreimageHex: bytesToHex(tokenPreimage),
    createToken: KeyedCreateTokenSchema.parse(`h1_${bytesToHex(createTokenDigest)}`),
  }
}
