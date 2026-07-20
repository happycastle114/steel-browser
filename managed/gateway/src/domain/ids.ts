import { z } from "zod"

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const WorkerIdSchema = z.enum(["worker-00", "worker-01"]).brand("WorkerId")
export type WorkerId = z.infer<typeof WorkerIdSchema>

export const InstanceIdSchema = z.string().uuid().regex(uuidV4).brand("InstanceId")
export type InstanceId = z.infer<typeof InstanceIdSchema>

export const AllocationIdSchema = z
  .string()
  .regex(/^allocation-[a-z0-9-]+$/)
  .brand("AllocationId")
export type AllocationId = z.infer<typeof AllocationIdSchema>

export const AdmissionTicketIdSchema = z
  .string()
  .regex(/^ticket-[a-z0-9-]+$/)
  .brand("AdmissionTicketId")
export type AdmissionTicketId = z.infer<typeof AdmissionTicketIdSchema>

export const PublicSessionIdSchema = z
  .string()
  .uuid()
  .regex(uuidV4)
  .brand("PublicSessionId")
export type PublicSessionId = z.infer<typeof PublicSessionIdSchema>

export const UpstreamSessionIdSchema = z
  .string()
  .uuid()
  .regex(uuidV4)
  .brand("UpstreamSessionId")
export type UpstreamSessionId = z.infer<typeof UpstreamSessionIdSchema>

export const EventCursorSchema = z.number().int().positive().safe().brand("EventCursor")
export type EventCursor = z.infer<typeof EventCursorSchema>
