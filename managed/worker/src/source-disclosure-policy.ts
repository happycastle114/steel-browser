import { z } from "zod"

const SourceDisclosureSchema = z
  .object({
    fork: z.string().url(),
    license: z.literal("Apache-2.0"),
    modifications: z.array(z.string().min(1)).readonly(),
    schemaVersion: z.literal(1),
    upstream: z
      .object({
        browserVersion: z.null(),
        browserVersionProof: z.literal("RUNTIME_READBACK_REQUIRED"),
        image: z.string().regex(/@sha256:[0-9a-f]{64}$/),
        registryReceipt: z.literal("upstream-image.lock.json"),
        repository: z.string().url(),
        revision: z.string().regex(/^[0-9a-f]{40}$/),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly()

export type SourceDisclosure = z.infer<typeof SourceDisclosureSchema>

export class SourceDisclosurePolicyError extends Error {
  override readonly name = "SourceDisclosurePolicyError"
}

export function parseSourceDisclosure(input: unknown): SourceDisclosure {
  return SourceDisclosureSchema.parse(input)
}

export function verifySourceDisclosure(
  input: unknown,
  shippedSources: readonly string[],
): void {
  const disclosure = parseSourceDisclosure(input)
  const declared = [...disclosure.modifications].sort()
  const shipped = [...new Set(shippedSources)].sort()
  if (new Set(declared).size !== declared.length) {
    throw new SourceDisclosurePolicyError("source disclosure contains duplicate paths")
  }
  if (JSON.stringify(declared) !== JSON.stringify(shipped)) {
    throw new SourceDisclosurePolicyError("source disclosure does not enumerate shipped source")
  }
}
