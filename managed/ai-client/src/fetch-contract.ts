export type AiFetchHeaders = Readonly<{ readonly get: (name: string) => string | null }>

export type AiFetchRequest = Readonly<{
  readonly body?: string
  readonly credentials: "same-origin"
  readonly headers: Readonly<Record<string, string>>
  readonly method: "GET" | "POST"
}>

export type AiFetchResponse = Readonly<{
  readonly arrayBuffer: () => Promise<ArrayBuffer>
  readonly headers: AiFetchHeaders
  readonly json: () => Promise<unknown>
  readonly ok: boolean
  readonly status: number
}>

export type AiFetch = (url: string, request: AiFetchRequest) => Promise<AiFetchResponse>

export type SteelManagedAiClientOptions = Readonly<{
  readonly baseUrl: string
  readonly fetch: AiFetch
  readonly headers?: Readonly<Record<string, string>>
}>
