import { z } from "zod"

import {
  COOLIFY_SECRET_FIXTURE_MODE,
  COOLIFY_SECRET_FIXTURE_SEQUENCE,
  RUNTIME_SCOPE_MUTATION,
} from "./runtime-scope-fixture-vocabulary.js"

const CLI_FLAG = {
  MODE: "--mode",
  SEQUENCE: "--sequence",
  ASSERT_INITIAL_UID: "--assert-initial-uid",
  ASSERT_CAP_FIELDS: "--assert-cap-fields",
  ASSERT_NO_SECRET_FD: "--assert-no-secret-fd",
  EVIDENCE: "--evidence",
  MUTATIONS: "--mutations",
  LIVE_OBSERVATION: "--live-observation",
} as const

const CliOptionsSchema = z
  .object({
    mode: z.nativeEnum(COOLIFY_SECRET_FIXTURE_MODE).optional(),
    sequence: z.nativeEnum(COOLIFY_SECRET_FIXTURE_SEQUENCE).optional(),
    initialUid: z.literal(0).optional(),
    capabilityFields: z.string().optional(),
    assertNoSecretFd: z.boolean(),
    evidenceDirectory: z.string().min(1).optional(),
    mutations: z.array(z.nativeEnum(RUNTIME_SCOPE_MUTATION)).optional(),
    liveObservationPath: z.string().min(1).optional(),
  })
  .strict()

type MutableCliOptions = {
  mode?: string
  sequence?: string
  initialUid?: number
  capabilityFields?: string
  assertNoSecretFd: boolean
  evidenceDirectory?: string
  mutations?: string[]
  liveObservationPath?: string
}

function readValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined) throw new TypeError(`missing value for ${flag}`)
  return value
}

export function parseCoolifySecretFixtureArguments(argv: readonly string[]) {
  const options: MutableCliOptions = { assertNoSecretFd: false }
  let index = 0
  while (index < argv.length) {
    const flag = argv[index]
    switch (flag) {
      case CLI_FLAG.MODE:
        options.mode = readValue(argv, index, flag)
        index += 2
        break
      case CLI_FLAG.SEQUENCE:
        options.sequence = readValue(argv, index, flag)
        index += 2
        break
      case CLI_FLAG.ASSERT_INITIAL_UID:
        options.initialUid = Number(readValue(argv, index, flag))
        index += 2
        break
      case CLI_FLAG.ASSERT_CAP_FIELDS:
        options.capabilityFields = readValue(argv, index, flag)
        index += 2
        break
      case CLI_FLAG.ASSERT_NO_SECRET_FD:
        options.assertNoSecretFd = true
        index += 1
        break
      case CLI_FLAG.EVIDENCE:
        options.evidenceDirectory = readValue(argv, index, flag)
        index += 2
        break
      case CLI_FLAG.MUTATIONS:
        options.mutations = readValue(argv, index, flag).split(",")
        index += 2
        break
      case CLI_FLAG.LIVE_OBSERVATION:
        options.liveObservationPath = readValue(argv, index, flag)
        index += 2
        break
      default:
        throw new TypeError(`unsupported fixture argument: ${String(flag)}`)
    }
  }
  return CliOptionsSchema.parse(options)
}
