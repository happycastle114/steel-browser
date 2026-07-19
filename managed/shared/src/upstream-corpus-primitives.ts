import { createHash } from "node:crypto"

export class CorpusVerificationError extends Error {
  override readonly name = "CorpusVerificationError"

  constructor(
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(detail, options)
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function parseJson(text: string, artifact: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CorpusVerificationError(`invalid JSON: ${artifact}`, {
        cause: error,
      })
    }
    throw error
  }
}

export function parseNdjson(text: string, artifact: string): readonly unknown[] {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n")
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new CorpusVerificationError(`invalid NDJSON records: ${artifact}`)
  }
  return lines.map((line, index) => parseJson(line, `${artifact}:${index + 1}`))
}
