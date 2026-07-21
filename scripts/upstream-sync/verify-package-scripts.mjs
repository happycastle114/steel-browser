import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadReviewedGateManifest } from "./reviewed-gate-manifest.mjs"

export async function verifyPackageScripts(repositoryRoot = process.cwd()) {
  const manifest = await loadReviewedGateManifest(repositoryRoot)
  for (const [packagePath, expectedScripts] of Object.entries(manifest.packageScripts)) {
    const packageValue = JSON.parse(await readFile(path.join(repositoryRoot, packagePath), "utf8"))
    for (const [scriptName, expectedCommand] of Object.entries(expectedScripts)) {
      if (packageValue.scripts?.[scriptName] !== expectedCommand) throw new Error(`reviewed package script drift: ${packagePath}#${scriptName}`)
    }
  }
  return { status: "VERIFIED", packageCount: Object.keys(manifest.packageScripts).length }
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  verifyPackageScripts().then((result) => console.log(`REVIEWED_PACKAGE_SCRIPTS_VERIFIED ${JSON.stringify(result)}`)).catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown package script verification failure")
    process.exitCode = 1
  })
}
