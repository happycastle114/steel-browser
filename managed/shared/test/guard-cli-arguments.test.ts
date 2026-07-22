import { describe, expect, it } from "vitest"

import {
  GUARD_CLI_ARGUMENT,
  GUARD_CLI_COMMAND,
  parseGuardCliArguments,
} from "../src/guard-cli-arguments.js"

describe("semantic guard CLI arguments", () => {
  it("uses the complete repository scan when no fixture is selected", () => {
    expect(
      parseGuardCliArguments([], GUARD_CLI_COMMAND.TYPE_SAFETY),
    ).toEqual({})
  })

  it("selects exactly one fixture through the shared argument", () => {
    expect(
      parseGuardCliArguments(
        [GUARD_CLI_ARGUMENT.FIXTURE, "/tmp/fixture.ts"],
        GUARD_CLI_COMMAND.RAW_STATE,
      ),
    ).toEqual({ fixturePath: "/tmp/fixture.ts" })
  })

  it.each(Object.values(GUARD_CLI_COMMAND))(
    "rejects unsupported arguments for %s",
    (command) => {
      expect(() => parseGuardCliArguments(["unsupported"], command)).toThrow(
        command,
      )
    },
  )
})
