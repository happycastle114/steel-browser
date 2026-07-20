import {
  AllocationIdSchema,
  AdmissionTicketIdSchema,
  InstanceIdSchema,
  PublicSessionIdSchema,
  UpstreamSessionIdSchema,
  WorkerDescriptorSchema,
  WorkerIdSchema,
  type Clock,
  type IdGenerator,
} from "../src/index.js"

export class FakeClock implements Clock {
  public constructor(private currentMilliseconds = 1_000) {}

  public now(): number {
    return this.currentMilliseconds
  }

  public advance(milliseconds: number): void {
    this.currentMilliseconds += milliseconds
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private allocationSequence = 0
  private ticketSequence = 0
  private sessionSequence = 0

  public nextAllocationId() {
    this.allocationSequence += 1
    return AllocationIdSchema.parse(`allocation-${this.allocationSequence}`)
  }

  public nextAdmissionTicketId() {
    this.ticketSequence += 1
    return AdmissionTicketIdSchema.parse(`ticket-${this.ticketSequence}`)
  }

  public nextPublicSessionId() {
    this.sessionSequence += 1
    return publicSessionId(this.sessionSequence)
  }
}

export function instanceId(sequence: number) {
  return InstanceIdSchema.parse(uuid(sequence))
}

export function publicSessionId(sequence: number) {
  return PublicSessionIdSchema.parse(uuid(1_000 + sequence))
}

export function upstreamSessionId(sequence: number) {
  return UpstreamSessionIdSchema.parse(publicSessionId(sequence))
}

export function workerDescriptor(workerSequence: number, instanceSequence: number) {
  return WorkerDescriptorSchema.parse({
    workerId: WorkerIdSchema.parse(`worker-0${workerSequence}`),
    instanceId: instanceId(instanceSequence),
    origin: `http://worker-0${workerSequence}:3000`,
  })
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`
}
