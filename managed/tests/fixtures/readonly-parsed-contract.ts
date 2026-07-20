import {
  ManagedDeploymentTopologySchema,
  PressureCapacityInputSchema,
  ShmTmpfsCapacityInputSchema,
} from "../../shared/src/managed-overlay.js"

declare const input: unknown

const topology = ManagedDeploymentTopologySchema.parse(input)
const ephemeral = ShmTmpfsCapacityInputSchema.parse(input)
const pressure = PressureCapacityInputSchema.parse(input)

topology.projects[0] = topology.projects[1]
ephemeral.manager.limitBytes = 1
ephemeral.worker.baseP95BytesByWorker[0] = 1
pressure.workerLoopMaxIntervalSeconds[0] = 1
