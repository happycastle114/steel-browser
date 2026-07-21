import type { PrivateSupervisorWireResponse } from "../../src/private-supervisor-contract.js"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Expect<Value extends true> = Value

type Pending = Extract<PrivateSupervisorWireResponse, { readonly kind: "CREATES_TOKEN_PENDING" }>
type Complete = Extract<PrivateSupervisorWireResponse, { readonly kind: "CREATES_TOKEN_COMPLETE" }>
type Metadata = Extract<PrivateSupervisorWireResponse, { readonly kind: "META" }>

export type PendingRetryIsLiteral = Expect<Equal<Pending["headers"]["retry-after"], "1">>
export type PendingRetryIsRequired = Expect<Equal<
  Record<string, never> extends Pick<Pending["headers"], "retry-after"> ? false : true,
  true
>>
export type CompleteOmitsRetry = Expect<Equal<"retry-after" extends keyof Complete["headers"] ? true : false, false>>
export type MetadataOmitsRetry = Expect<Equal<"retry-after" extends keyof Metadata["headers"] ? true : false, false>>
