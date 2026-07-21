const PRIVATE_TELEMETRY_SINK_PATTERN =
  /\b(?:(?:console|log|logger)\.(?:debug|error|info|log|warn)|(?:metrics|span|telemetry|tracer)\.(?:addEvent|record|setAttribute)|process\.(?:stderr|stdout)\.write)\s*\(/

export class PrivateSupervisorTelemetryPolicyError extends Error {
  override readonly name = "PrivateSupervisorTelemetryPolicyError"
}

export function verifyPrivateSupervisorTelemetrySource(source: string): void {
  if (PRIVATE_TELEMETRY_SINK_PATTERN.test(source)) {
    throw new PrivateSupervisorTelemetryPolicyError(
      "private supervisor request source must not write request data to telemetry sinks",
    )
  }
}
