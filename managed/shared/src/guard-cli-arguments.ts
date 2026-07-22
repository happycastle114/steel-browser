export const GUARD_CLI_ARGUMENT = {
  FIXTURE: "--fixture",
} as const

export const GUARD_CLI_COMMAND = {
  RAW_STATE: "check:raw-state-comparisons",
  TYPE_SAFETY: "check:managed-shared-type-safety",
} as const

export type GuardCliCommand =
  (typeof GUARD_CLI_COMMAND)[keyof typeof GUARD_CLI_COMMAND]

export type GuardCliOptions = Readonly<{
  readonly fixturePath?: string | undefined
}>

function usage(command: GuardCliCommand): string {
  return `usage: ${command} [${GUARD_CLI_ARGUMENT.FIXTURE} <path>]`
}

export function parseGuardCliArguments(
  argv: readonly string[],
  command: GuardCliCommand,
): GuardCliOptions {
  switch (argv.length) {
    case 0:
      return {}
    case 2:
      if (
        argv[0] === GUARD_CLI_ARGUMENT.FIXTURE &&
        argv[1] !== undefined
      ) {
        return { fixturePath: argv[1] }
      }
      throw new TypeError(usage(command))
    default:
      throw new TypeError(usage(command))
  }
}
