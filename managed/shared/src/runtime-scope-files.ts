import { readFile } from "node:fs/promises"
import path from "node:path"

import { RuntimeScopeCertificateSchema } from "./runtime-scope.js"
import { RUNTIME_SCOPE_PATH } from "./runtime-scope-vocabulary.js"
import {
  verifyRuntimeScopeCertificate,
  type RuntimeScopeVerification,
} from "./runtime-scope-verifier.js"
import { parseJson } from "./upstream-corpus-primitives.js"

async function readUtf8(filePath: string): Promise<string> {
  return readFile(filePath, "utf8")
}

export async function verifyRuntimeScopeAtRepository(
  repositoryRoot: string,
): Promise<RuntimeScopeVerification> {
  const certificateText = await readUtf8(path.join(repositoryRoot, RUNTIME_SCOPE_PATH))
  const certificate = RuntimeScopeCertificateSchema.parse(
    parseJson(certificateText, RUNTIME_SCOPE_PATH),
  )
  const entries = await Promise.all(
    Object.values(certificate.sourceContracts).map(async (contract) => [
      contract.path,
      await readUtf8(path.join(repositoryRoot, contract.path)),
    ] as const),
  )
  return verifyRuntimeScopeCertificate({
    certificateInput: certificate,
    sourceTexts: Object.fromEntries(entries),
  })
}
