export const AuditDecision = Object.freeze({
  BLOCK: "BLOCK",
  INVALID: "INVALID",
  PASS: "PASS",
});

const Severity = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  INFO: "info",
  LOW: "low",
  MODERATE: "moderate",
});

const ResidualReason = Object.freeze({
  UNINSTALLED_LOCKFILE_ONLY: "UNINSTALLED_LOCKFILE_ONLY",
});

const severities = Object.values(Severity);
const blockingSeverities = new Set([Severity.CRITICAL, Severity.HIGH]);

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isViaEntry = (value) =>
  typeof value === "string" ||
  (isRecord(value) &&
    Number.isSafeInteger(value.source) &&
    severities.includes(value.severity));

const hidesBlockingSeverity = (finding) =>
  !blockingSeverities.has(finding.severity) &&
  finding.via.some(
    (entry) => isRecord(entry) && blockingSeverities.has(entry.severity),
  );

const sameValues = (left, right) => {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

const isIsoDate = (value) => {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
};

const blockingSources = (finding) =>
  finding.via
    .filter(
      (via) =>
        isRecord(via) &&
        Number.isSafeInteger(via.source) &&
        blockingSeverities.has(via.severity),
    )
    .map((via) => via.source)
    .sort((left, right) => left - right);

const matchesResidual = ({ evaluationDate, finding, residual }) => {
  const sources = blockingSources(finding);
  return (
    sources.length > 0 &&
    isRecord(residual) &&
    residual.name === finding.name &&
    residual.reason === ResidualReason.UNINSTALLED_LOCKFILE_ONLY &&
    isIsoDate(residual.expiresOn) &&
    residual.expiresOn >= evaluationDate &&
    Array.isArray(residual.nodes) &&
    residual.nodes.every((node) => typeof node === "string") &&
    Array.isArray(residual.advisorySources) &&
    residual.advisorySources.every(Number.isSafeInteger) &&
    sameValues(residual.nodes, finding.nodes) &&
    sameValues(residual.advisorySources, sources)
  );
};

const metadataMatches = (audit) => {
  const counts = Object.fromEntries(
    severities.map((severity) => [severity, 0]),
  );
  for (const [name, finding] of Object.entries(audit.vulnerabilities)) {
    if (
      !isRecord(finding) ||
      finding.name !== name ||
      !severities.includes(finding.severity) ||
      !Array.isArray(finding.nodes) ||
      !finding.nodes.every((node) => typeof node === "string") ||
      !Array.isArray(finding.via) ||
      !finding.via.every(isViaEntry) ||
      hidesBlockingSeverity(finding)
    ) {
      return false;
    }
    counts[finding.severity] += 1;
  }

  const metadata = audit.metadata?.vulnerabilities;
  if (!isRecord(metadata)) return false;
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return (
    severities.every((severity) => metadata[severity] === counts[severity]) &&
    metadata.total === total
  );
};

export const evaluateProductionAudit = ({
  audit,
  evaluationDate,
  inventory,
  policy,
}) => {
  if (
    !isRecord(audit) ||
    audit.auditReportVersion !== 2 ||
    !isRecord(audit.vulnerabilities) ||
    !isRecord(inventory) ||
    !Array.isArray(inventory.packages) ||
    !isRecord(policy) ||
    !Array.isArray(policy.residuals) ||
    !isIsoDate(evaluationDate) ||
    !metadataMatches(audit)
  ) {
    return { decision: AuditDecision.INVALID };
  }

  const installed = new Set(inventory.packages.map((entry) => entry.location));
  const blockers = [];
  const residuals = [];

  for (const finding of Object.values(audit.vulnerabilities)) {
    if (!blockingSeverities.has(finding.severity)) continue;

    const installedNodes = finding.nodes.filter((node) => installed.has(node));
    if (installedNodes.length > 0) {
      blockers.push({
        installedNodes: installedNodes.sort(),
        name: finding.name,
        severity: finding.severity,
      });
      continue;
    }

    const residual = policy.residuals.find((entry) =>
      matchesResidual({ evaluationDate, finding, residual: entry }),
    );
    if (residual === undefined) {
      blockers.push({
        installedNodes: [],
        name: finding.name,
        severity: finding.severity,
      });
      continue;
    }
    residuals.push(residual);
  }

  return blockers.length === 0
    ? { blockers: [], decision: AuditDecision.PASS, residuals }
    : { blockers, decision: AuditDecision.BLOCK, residuals };
};
