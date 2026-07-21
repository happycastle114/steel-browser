import { z } from "zod"

import { withDeepFrozenOutput } from "./deep-readonly.js"
import {
  CAPACITY_PHASE,
  DISK_CAPACITY_STAGE,
  INODE_CAPACITY_STAGE,
} from "./deployment-vocabulary.js"

const NonNegativeMeasurementSchema = z.number().finite().nonnegative()
const PositiveSafeIntegerSchema = z.number().int().safe().positive()
const NonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative()

const CompleteBaselineFields = {
  usableSamples: NonNegativeSafeIntegerSchema,
  sampleWindowSeconds: NonNegativeMeasurementSchema,
  sampleIntervalSeconds: NonNegativeMeasurementSchema,
} as const

const MemoryCapacityFields = {
  ...CompleteBaselineFields,
  hostTotalMemoryMiB: NonNegativeMeasurementSchema,
  hostNonSteelP95MiB: NonNegativeMeasurementSchema,
  managerLimitBytes: PositiveSafeIntegerSchema,
  workerLimitBytes: PositiveSafeIntegerSchema,
} as const

const MemoryCapacityInputBaseSchema = z.discriminatedUnion("phase", [
  z.object({
    ...MemoryCapacityFields,
    phase: z.literal(CAPACITY_PHASE.DISPOSABLE_CANARY),
    legacySteelP95MiB: NonNegativeMeasurementSchema,
  }).strict(),
  z.object({
    ...MemoryCapacityFields,
    phase: z.literal(CAPACITY_PHASE.PRODUCTION_SERIAL),
  }).strict(),
])
export const MemoryCapacityInputSchema = withDeepFrozenOutput(MemoryCapacityInputBaseSchema)

const ThrottlingObservationSchema = z
  .object({
    nrThrottled: NonNegativeSafeIntegerSchema,
    nrPeriods: PositiveSafeIntegerSchema,
  })
  .strict()

const CpuCapacityFields = {
  ...CompleteBaselineFields,
  hostLogicalCpuCount: PositiveSafeIntegerSchema,
  hostNonSteelCpuP95Cores: NonNegativeMeasurementSchema,
  managedCpuP95Cores: NonNegativeMeasurementSchema,
  loadOneP95: NonNegativeMeasurementSchema,
  throttling: z.tuple([
    ThrottlingObservationSchema,
    ThrottlingObservationSchema,
    ThrottlingObservationSchema,
  ]),
} as const

const CpuCapacityInputBaseSchema = z.discriminatedUnion("phase", [
  z.object({
    ...CpuCapacityFields,
    phase: z.literal(CAPACITY_PHASE.DISPOSABLE_CANARY),
    legacySteelCpuP95Cores: NonNegativeMeasurementSchema,
  }).strict(),
  z.object({
    ...CpuCapacityFields,
    phase: z.literal(CAPACITY_PHASE.PRODUCTION_SERIAL),
  }).strict(),
])
export const CpuCapacityInputSchema = withDeepFrozenOutput(CpuCapacityInputBaseSchema)

const DiskCapacityInputBaseSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal(DISK_CAPACITY_STAGE.BEFORE_PULLS),
    freeDiskBytes: NonNegativeSafeIntegerSchema,
    managerImageSizeBytes: NonNegativeSafeIntegerSchema,
    workerImageSizeBytes: NonNegativeSafeIntegerSchema,
    legacyRollbackLayerBytes: NonNegativeSafeIntegerSchema,
    signedReceiptBundleBytes: NonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    stage: z.literal(DISK_CAPACITY_STAGE.AFTER_START),
    freeDiskBytes: NonNegativeSafeIntegerSchema,
    filesystemBytes: PositiveSafeIntegerSchema,
  }).strict(),
])
export const DiskCapacityInputSchema = withDeepFrozenOutput(DiskCapacityInputBaseSchema)

const InodeCapacityInputBaseSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal(INODE_CAPACITY_STAGE.BEFORE_PULLS),
    freeInodes: NonNegativeSafeIntegerSchema,
    managerImageInodes: NonNegativeSafeIntegerSchema,
    workerImageInodes: NonNegativeSafeIntegerSchema,
    legacyRollbackInodes: NonNegativeSafeIntegerSchema,
  }).strict(),
  z.object({
    stage: z.literal(INODE_CAPACITY_STAGE.AFTER_START),
    freeInodes: NonNegativeSafeIntegerSchema,
    totalInodes: PositiveSafeIntegerSchema,
  }).strict(),
])
export const InodeCapacityInputSchema = withDeepFrozenOutput(InodeCapacityInputBaseSchema)

export type MemoryCapacityInput = z.infer<typeof MemoryCapacityInputSchema>
export type CpuCapacityInput = z.infer<typeof CpuCapacityInputSchema>
export type DiskCapacityInput = z.infer<typeof DiskCapacityInputSchema>
export type InodeCapacityInput = z.infer<typeof InodeCapacityInputSchema>
