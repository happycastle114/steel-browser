import { build } from "esbuild"

const FORBIDDEN_INPUT = [
  "@modelcontextprotocol/sdk",
  "fastify",
  "node:",
  "zod-to-json-schema",
  "/managed/gateway/",
] as const
const FORBIDDEN_OUTPUT = [
  "@modelcontextprotocol/sdk",
  "node:crypto",
  "node:net",
  "fastify",
] as const

const result = await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  metafile: true,
  write: false,
})

const inputs = Object.keys(result.metafile.inputs)
const output = result.outputFiles.map((file) => file.text).join("\n")
for (const forbidden of FORBIDDEN_INPUT) {
  if (inputs.some((input) => input.includes(forbidden))) {
    throw new TypeError(`browser bundle includes forbidden input: ${forbidden}`)
  }
}
for (const forbidden of FORBIDDEN_OUTPUT) {
  if (output.includes(forbidden)) {
    throw new TypeError(`browser bundle includes forbidden output: ${forbidden}`)
  }
}
console.log(`managed AI browser bundle passed: ${inputs.length} inputs, ${output.length} bytes`)
