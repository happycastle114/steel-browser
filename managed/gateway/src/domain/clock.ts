import { randomUUID } from "node:crypto"
import {
  AdmissionTicketIdSchema,
  AllocationIdSchema,
  PublicSessionIdSchema,
  type AdmissionTicketId,
  type AllocationId,
  type PublicSessionId,
} from "./ids.js"

export interface Clock {
  now(): number
}

export interface IdGenerator {
  nextAllocationId(): AllocationId
  nextAdmissionTicketId(): AdmissionTicketId
  nextPublicSessionId(): PublicSessionId
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now()
  }
}

export class RandomIdGenerator implements IdGenerator {
  public nextAllocationId(): AllocationId {
    return AllocationIdSchema.parse(`allocation-${randomUUID()}`)
  }

  public nextAdmissionTicketId(): AdmissionTicketId {
    return AdmissionTicketIdSchema.parse(`ticket-${randomUUID()}`)
  }

  public nextPublicSessionId(): PublicSessionId {
    return PublicSessionIdSchema.parse(randomUUID())
  }
}
