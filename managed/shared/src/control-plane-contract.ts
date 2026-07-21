import { z } from "zod"

export const CONTROL_PLANE_API_VERSION = "2026-07-01" as const
export const CONTROL_PLANE_SERVICE_NAME = "happycastle-steel-managed" as const
export const MCP_PROTOCOL_VERSION = "2025-11-25" as const

export const ControlPlaneApiVersionSchema = z.literal(CONTROL_PLANE_API_VERSION)
export const ToolVersionSchema = z.string().regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u)
