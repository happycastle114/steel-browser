import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import {
  main,
  type ManagerCliDependencies,
} from "../src/cli.js"
import { ManagerShutdownSignal } from "../src/runtime/process-lifecycle.js"

describe("manager CLI", () => {
  it("builds the production runtime from explicit inputs and owns its signal lifecycle", async () => {
    const signals = new EventEmitter()
    const events: string[] = []
    const environment = { STEEL_MANAGED_CONFIG_JSON: "fixture" }
    const arguments_ = ["--fixture"]
    const dependencies: ManagerCliDependencies = {
      createRuntime: async (input) => {
        expect(input).toEqual({ arguments: arguments_, environment })
        return {
          close: async () => {
            events.push("close")
          },
          start: async () => {
            events.push("start")
          },
        }
      },
      environment,
      process: signals,
    }

    const running = main(arguments_, dependencies)
    await vi.waitFor(() => expect(events).toEqual(["start"]))
    signals.emit(ManagerShutdownSignal.TERMINATE)
    await running

    expect(events).toEqual(["start", "close"])
  })
})
