import {
  AdmissionIdSchema,
  SessionIdSchema,
  type AiActionRequest,
  type ManagedToolResult,
} from "@happycastle/steel-managed-shared/ai-client"

import { AiClientProtocolError } from "./errors.js"

function property(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined
}

function nestedProperty(value: unknown, container: string, key: string): unknown {
  return property(property(value, container), key)
}

export function bindResultIdentity(action: AiActionRequest, result: ManagedToolResult): void {
  const expectedSession = SessionIdSchema.safeParse(property(action.arguments, "sessionId"))
  if (expectedSession.success) {
    const direct = SessionIdSchema.safeParse(property(result, "sessionId"))
    const nested = SessionIdSchema.safeParse(nestedProperty(result, "session", "sessionId"))
    const returned = direct.success ? direct.data : nested.success ? nested.data : undefined
    if (returned === undefined || returned !== expectedSession.data) {
      throw new AiClientProtocolError("Managed AI result does not match the requested session")
    }
  }
  const expectedAdmission = AdmissionIdSchema.safeParse(property(action.arguments, "admissionId"))
  if (expectedAdmission.success) {
    const direct = AdmissionIdSchema.safeParse(property(result, "admissionId"))
    const nested = AdmissionIdSchema.safeParse(nestedProperty(result, "admission", "admissionId"))
    const returned = direct.success ? direct.data : nested.success ? nested.data : undefined
    if (returned === undefined || returned !== expectedAdmission.data) {
      throw new AiClientProtocolError("Managed AI result does not match the requested admission")
    }
  }
}
