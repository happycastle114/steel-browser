import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

async function packageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await packageFiles(entryPath)))
    else if (entry.isFile() && entry.name === "package.json") files.push(entryPath)
  }
  return files
}

export async function verifyLicense(repositoryRoot) {
  const root = path.resolve(repositoryRoot)
  const packagePaths = await packageFiles(root)
  for (const packagePath of packagePaths) {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"))
    if (packageJson.license !== undefined && packageJson.license !== "Apache-2.0") {
      throw new Error(`package license drift: ${path.relative(root, packagePath)}`)
    }
  }
  const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  if (rootPackage.license !== "Apache-2.0") throw new Error("root package must remain Apache-2.0")
  const license = await readFile(path.join(root, "LICENSE"), "utf8")
  if (!/^\s+Apache License\n\s+Version 2\.0, January 2004\n/mu.test(license)) {
    throw new Error("Apache-2.0 LICENSE header is missing")
  }
  return { status: "VERIFIED", packages: packagePaths.length, license: "Apache-2.0" }
}

async function main() {
  const result = await verifyLicense(process.cwd())
  console.log(`UPSTREAM_LICENSE_VERIFIED ${JSON.stringify(result)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown license verification failure")
    process.exitCode = 1
  })
}
