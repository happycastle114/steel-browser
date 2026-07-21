import {
  createProductionManagerRuntime,
  type ProductionManagerRuntimeInput,
} from "./runtime/production-composition.js"
import {
  runManagerRuntimeUntilSignal,
  type ManagerProcessPort,
} from "./runtime/process-lifecycle.js"
import { pathToFileURL } from "node:url"

type ManagerCliRuntime = Readonly<{
  close(): Promise<void>
  start(): Promise<void>
}>

export type ManagerCliDependencies = Readonly<{
  createRuntime(input: ProductionManagerRuntimeInput): Promise<ManagerCliRuntime>
  environment: Readonly<Record<string, string | undefined>>
  process: ManagerProcessPort
}>

const PRODUCTION_DEPENDENCIES: ManagerCliDependencies = {
  createRuntime: createProductionManagerRuntime,
  environment: process.env,
  process,
}

export async function main(
  arguments_: readonly string[],
  dependencies: ManagerCliDependencies = PRODUCTION_DEPENDENCIES,
): Promise<void> {
  const runtime = await dependencies.createRuntime({
    arguments: arguments_,
    environment: dependencies.environment,
  })
  await runManagerRuntimeUntilSignal(runtime, dependencies.process)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main(process.argv.slice(2))
}
