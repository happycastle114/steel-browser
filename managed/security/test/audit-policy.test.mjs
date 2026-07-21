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

const cleanAudit = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: cleanCounts },
  vulnerabilities: {},
};

const inventory = {
  packages: [
    {
      integrity: "sha512-safe",
      kind: "REGISTRY",
      location: "node_modules/safe-package",
      name: "safe-package",
      sourceLocation: null,
      version: "1.0.0",
    },
  ],
};

const policy = {
  residuals: [],
};

test("returns PASS when the installed production tree has no blocking advisory", () => {
  // Given a clean npm audit report and its exact installed inventory.
  // When the production audit policy is evaluated.
  const result = evaluateProductionAudit({
    audit: cleanAudit,
    evaluationDate: "2026-07-21",
    inventory,
    policy,
  });

  // Then the tree passes without residual findings.
  assert.equal(result.decision, AuditDecision.PASS);
  assert.deepEqual(result.residuals, []);
});

test("returns BLOCK when a critical advisory node is installed", () => {
  // Given a critical advisory whose node exists in the production inventory.
  const audit = {
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: { ...cleanCounts, critical: 1, total: 1 },
    },
    vulnerabilities: {
      "safe-package": {
        effects: [],
        fixAvailable: true,
        isDirect: false,
        name: "safe-package",
        nodes: ["node_modules/safe-package"],
        range: "<2.0.0",
        severity: "critical",
        via: [
          {
            name: "safe-package",
            range: "<2.0.0",
            severity: "critical",
            source: 9001,
            title: "fixture",
            url: "https://github.com/advisories/GHSA-fixture",
          },
        ],
      },
    },
  };

  // When the policy is evaluated.
  const result = evaluateProductionAudit({
    audit,
    evaluationDate: "2026-07-21",
    inventory,
    policy,
  });

  // Then the installed advisory blocks the image.
  assert.equal(result.decision, AuditDecision.BLOCK);
  assert.deepEqual(result.blockers, [
    {
      installedNodes: ["node_modules/safe-package"],
      name: "safe-package",
      severity: "critical",
    },
  ]);
});

test("returns BLOCK when an uninstalled advisory is not exactly allowlisted", () => {
  // Given a high advisory node absent from the installed inventory.
  const audit = {
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: { ...cleanCounts, high: 1, total: 1 },
    },
    vulnerabilities: {
      vite: {
        effects: [],
        fixAvailable: true,
        isDirect: false,
        name: "vite",
        nodes: ["node_modules/vite"],
        range: "<7.0.0",
        severity: "high",
        via: [
          {
            name: "vite",
            range: "<7.0.0",
            severity: "high",
            source: 9002,
            title: "fixture",
            url: "https://github.com/advisories/GHSA-absent",
          },
        ],
      },
    },
  };

  // When the policy is evaluated without a residual entry.
  const result = evaluateProductionAudit({
    audit,
    evaluationDate: "2026-07-21",
    inventory,
    policy,
  });

  // Then lockfile-only findings still fail closed.
  assert.equal(result.decision, AuditDecision.BLOCK);
});

test("accepts only an unexpired exact lockfile-only residual", () => {
  // Given a high advisory absent from inventory and an exact bounded residual.
  const audit = {
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: { ...cleanCounts, high: 1, total: 1 },
    },
    vulnerabilities: {
      vite: {
        effects: [],
        fixAvailable: true,
        isDirect: false,
        name: "vite",
        nodes: ["node_modules/vite"],
        range: "<7.0.0",
        severity: "high",
        via: [
          {
            name: "vite",
            range: "<7.0.0",
            severity: "high",
            source: 9002,
            title: "fixture",
            url: "https://github.com/advisories/GHSA-absent",
          },
        ],
      },
    },
  };
  const boundedPolicy = {
    residuals: [
      {
        advisorySources: [9002],
        expiresOn: "2026-08-01",
        name: "vite",
        nodes: ["node_modules/vite"],
        reason: "UNINSTALLED_LOCKFILE_ONLY",
      },
    ],
  };

  // When the policy is evaluated before expiry.
  const result = evaluateProductionAudit({
    audit,
    evaluationDate: "2026-07-21",
    inventory,
    policy: boundedPolicy,
  });

  // Then only that exact finding is retained as a residual.
  assert.equal(result.decision, AuditDecision.PASS);
  assert.deepEqual(result.residuals, boundedPolicy.residuals);
});

test("returns INVALID when npm metadata contradicts vulnerability entries", () => {
  // Given metadata that hides a high vulnerability entry.
  const audit = {
    auditReportVersion: 2,
    metadata: { vulnerabilities: cleanCounts },
    vulnerabilities: {
      hidden: {
        effects: [],
        fixAvailable: false,
        isDirect: false,
        name: "hidden",
        nodes: ["node_modules/hidden"],
        range: "*",
        severity: "high",
        via: [],
      },
    },
  };

  // When the policy is evaluated.
  const result = evaluateProductionAudit({
    audit,
    evaluationDate: "2026-07-21",
    inventory,
    policy,
  });

  // Then inconsistent audit evidence is rejected.
  assert.equal(result.decision, AuditDecision.INVALID);
});
