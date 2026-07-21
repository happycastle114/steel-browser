import {
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_SERVICE_NAME,
  MCP_PROTOCOL_VERSION,
  ToolVersionSchema,
  createManagedToolContracts,
  type ControlPlaneConfig,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"

export function createManagedAiContracts(input: Readonly<{
  readonly config: ControlPlaneConfig
  readonly selectedOrigin: SelectedPublicOrigin
  readonly serviceVersion: string
}>) {
  const serviceVersion = ToolVersionSchema.parse(input.serviceVersion)
  const catalog = createManagedToolContracts({
    selectedOrigin: input.selectedOrigin,
    controlPlaneConfig: input.config,
  })
  const common = {
    apiVersion: CONTROL_PLANE_API_VERSION,
    service: { name: CONTROL_PLANE_SERVICE_NAME, version: serviceVersion },
    mcp: { endpoint: "/mcp", protocolVersion: MCP_PROTOCOL_VERSION, stateless: true },
    limits: catalog.limits,
  } as const
  return Object.freeze({
    ...catalog,
    capabilities: catalog.capabilitiesSchema.parse({ ...common, tools: catalog.descriptors }),
    tools: catalog.toolsResponseSchema.parse({ ...common, tools: catalog.schemaDescriptors }),
    serviceVersion,
  })
}
