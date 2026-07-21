import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditDecision,
  evaluateProductionAudit,
} from "../lib/audit-policy.mjs";

const cleanCounts = {
  critical: 0,
  high: 1,
  info: 0,
  low: 0,
  moderate: 0,
  total: 1,
};

for (const [label, mutate] of [
  ["missing nodes", (finding) => delete finding.nodes],
  ["string nodes", (finding) => (finding.nodes = "node_modules/safe-package")],
  ["missing via", (finding) => delete finding.via],
]) {
  test(`returns INVALID for a high finding with ${label}`, () => {
    const finding = {
      name: "safe-package",
      nodes: ["node_modules/safe-package"],
      severity: "high",
      via: [{ severity: "high", source: 9004 }],
    };
    mutate(finding);
    const result = evaluateProductionAudit({
      audit: {
        auditReportVersion: 2,
        metadata: { vulnerabilities: cleanCounts },
        vulnerabilities: { "safe-package": finding },
      },
      evaluationDate: "2026-07-21",
      inventory: { packages: [] },
      policy: { residuals: [] },
    });

    assert.equal(result.decision, AuditDecision.INVALID);
  });
}

test("returns INVALID when a moderate finding hides a high advisory", () => {
  const result = evaluateProductionAudit({
    audit: {
      auditReportVersion: 2,
      metadata: {
        vulnerabilities: { ...cleanCounts, high: 0, moderate: 1 },
      },
      vulnerabilities: {
        hidden: {
          name: "hidden",
          nodes: ["node_modules/hidden"],
          severity: "moderate",
          via: [{ severity: "high", source: 9005 }],
        },
      },
    },
    evaluationDate: "2026-07-21",
    inventory: { packages: [] },
    policy: { residuals: [] },
  });

  assert.equal(result.decision, AuditDecision.INVALID);
});
