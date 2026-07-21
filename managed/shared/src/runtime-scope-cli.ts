import { verifyRuntimeScopeAtRepository } from "./runtime-scope-files.js"

async function main(): Promise<void> {
  const result = await verifyRuntimeScopeAtRepository(process.cwd())
  console.log(`RUNTIME_SCOPE_VERIFIED ${JSON.stringify(result)}`)
}

main().catch((error: unknown) => {
  if (error instanceof Error) console.error(`${error.name}: ${error.message}`)
  else console.error("Unknown runtime-scope verifier failure")
  process.exitCode = 1
})
