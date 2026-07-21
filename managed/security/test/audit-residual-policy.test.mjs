import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditDecision,
  evaluateProductionAudit,
} from "../lib/audit-policy.mjs";

const cleanCounts = {
  critical: 0,
  high: 0,
  info: 0,
  low: 0,
  moderate: 0,
  total: 0,
};

const inventory = { packages: [] };

test("rejects a residual without a concrete blocking advisory source", () => {
  // Given a transitive high finding represented only by a package-name edge.
  const audit = {
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: { ...cleanCounts, high: 1, total: 1 },
    },
    vulnerabilities: {
      parent: {
        name: "parent",
        nodes: ["node_modules/absent-parent"],
        severity: "high",
        via: ["child"],
      },
    },
  };
  const policy = {
    residuals: [
      {
        advisorySources: [],
        expiresOn: "2026-08-01",
        name: "parent",
        nodes: ["node_modules/absent-parent"],
        reason: "UNINSTALLED_LOCKFILE_ONLY",
      },
    ],
  };

  // When the unverifiable residual is evaluated.
  const result = evaluateProductionAudit({
    audit,
    evaluationDate: "2026-07-21",
    inventory,
    policy,
  });

  // Then the policy fails closed instead of trusting a source-less exception.
  assert.equal(result.decision, AuditDecision.BLOCK);
});

test("rejects malformed evaluation dates", () => {
  // Given a clean report paired with an impossible calendar date.
  const audit = {
    auditReportVersion: 2,
    metadata: { vulnerabilities: cleanCounts },
    vulnerabilities: {},
  };

  // When the temporal evidence is evaluated.
  const result = evaluateProductionAudit({
    audit,
    evaluationDate: "2026-02-31",
    inventory,
    policy: { residuals: [] },
  });

  // Then malformed temporal evidence is invalid.
  assert.equal(result.decision, AuditDecision.INVALID);
});

test("rejects a finding key that differs from its package name", () => {
  // Given an audit entry stored under a misleading object key.
  const audit = {
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: { ...cleanCounts, high: 1, total: 1 },
    },
    vulnerabilities: {
      misleading: {
        name: "safe-package",
        nodes: ["node_modules/safe-package"],
        severity: "high",
        via: [],
      },
    },
  };

  // When evaluated, then ambiguous package identity is rejected.
  const result = evaluateProductionAudit({
    audit,
    evaluationDate: "2026-07-21",
    inventory,
    policy: { residuals: [] },
  });
  assert.equal(result.decision, AuditDecision.INVALID);
});
