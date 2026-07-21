import assert from "node:assert/strict";

import {
  AuditDecision,
  evaluateProductionAudit,
} from "../lib/audit-policy.mjs";
import {
  evaluateProductionInventory,
  InventoryDecision,
} from "../lib/inventory-policy.mjs";

const counts = {
  critical: 0,
  high: 0,
  info: 0,
  low: 0,
  moderate: 0,
  total: 0,
};

const cleanAudit = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: counts },
  vulnerabilities: {},
};

const cleanInventory = {
  packages: [
    {
      contentSha256: null,
      dependencyScope: null,
      integrity: null,
      kind: "WORKSPACE",
      location: "node_modules/@happycastle/steel-managed-worker",
      name: "@happycastle/steel-managed-worker",
      sourceLocation: "managed/worker",
      version: "0.0.0",
    },
    {
      contentSha256: "a".repeat(64),
      dependencyScope: "PRODUCTION",
      integrity: "sha512-runtime",
      kind: "REGISTRY",
      location: "node_modules/zod",
      name: "zod",
      sourceLocation: null,
      version: "3.25.76",
    },
  ],
};

const inventoryPolicy = {
  forbiddenPackages: ["vite"],
  requiredWorkspaces: ["@happycastle/steel-managed-worker"],
  workspaceSources: {
    "@happycastle/steel-managed-worker": "managed/worker",
  },
};

const vulnerableAudit = ({ metadataCounts = true, nodes }) => ({
  auditReportVersion: 2,
  metadata: {
    vulnerabilities: metadataCounts ? { ...counts, high: 1, total: 1 } : counts,
  },
  vulnerabilities: {
    zod: {
      effects: [],
      fixAvailable: true,
      isDirect: false,
      name: "zod",
      nodes,
      range: "<4.0.0",
      severity: "high",
      via: [
        {
          name: "zod",
          range: "<4.0.0",
          severity: "high",
          source: 9003,
          title: "mutation",
          url: "https://github.com/advisories/GHSA-mutation",
        },
      ],
    },
  },
});

const malformedAudit = (mutate) => {
  const audit = vulnerableAudit({ nodes: ["node_modules/zod"] });
  mutate(audit.vulnerabilities.zod);
  return audit;
};

const auditMutations = [
  {
    expected: AuditDecision.BLOCK,
    name: "installed high advisory",
    value: vulnerableAudit({ nodes: ["node_modules/zod"] }),
  },
  {
    expected: AuditDecision.BLOCK,
    name: "unallowlisted lockfile-only advisory",
    value: vulnerableAudit({ nodes: ["node_modules/absent"] }),
  },
  {
    expected: AuditDecision.INVALID,
    name: "forged metadata counters",
    value: vulnerableAudit({
      metadataCounts: false,
      nodes: ["node_modules/zod"],
    }),
  },
  {
    expected: AuditDecision.INVALID,
    name: "high advisory nodes removed",
    value: malformedAudit((finding) => delete finding.nodes),
  },
  {
    expected: AuditDecision.INVALID,
    name: "high advisory nodes changed to string",
    value: malformedAudit((finding) => (finding.nodes = "node_modules/zod")),
  },
  {
    expected: AuditDecision.INVALID,
    name: "high advisory via removed",
    value: malformedAudit((finding) => delete finding.via),
  },
  {
    expected: AuditDecision.INVALID,
    name: "moderate finding hides high via advisory",
    value: {
      auditReportVersion: 2,
      metadata: {
        vulnerabilities: { ...counts, moderate: 1, total: 1 },
      },
      vulnerabilities: {
        zod: {
          name: "zod",
          nodes: ["node_modules/zod"],
          severity: "moderate",
          via: [{ severity: "high", source: 9003 }],
        },
      },
    },
  },
];

for (const mutation of auditMutations) {
  const result = evaluateProductionAudit({
    audit: mutation.value,
    evaluationDate: "2026-07-21",
    inventory: cleanInventory,
    policy: { residuals: [] },
  });
  assert.equal(result.decision, mutation.expected, mutation.name);
}

const inventoryMutations = [
  {
    expected: InventoryDecision.BLOCK,
    name: "required workspace removed",
    value: { packages: cleanInventory.packages.slice(1) },
  },
  {
    expected: InventoryDecision.BLOCK,
    name: "development package retained",
    value: {
      packages: [
        ...cleanInventory.packages,
        {
          contentSha256: "d".repeat(64),
          dependencyScope: "DEVELOPMENT",
          integrity: "sha512-development",
          kind: "REGISTRY",
          location: "node_modules/esbuild",
          name: "esbuild",
          sourceLocation: null,
          version: "0.28.1",
        },
      ],
    },
  },
  {
    expected: InventoryDecision.BLOCK,
    name: "build package retained",
    value: {
      packages: [
        ...cleanInventory.packages,
        {
          contentSha256: "b".repeat(64),
          dependencyScope: "PRODUCTION",
          integrity: "sha512-build",
          kind: "REGISTRY",
          location: "node_modules/vite",
          name: "vite",
          sourceLocation: null,
          version: "6.4.3",
        },
      ],
    },
  },
  {
    expected: InventoryDecision.INVALID,
    name: "registry integrity removed",
    value: {
      packages: cleanInventory.packages.map((entry) =>
        entry.name === "zod" ? { ...entry, integrity: null } : entry,
      ),
    },
  },
  {
    expected: InventoryDecision.BLOCK,
    name: "registry package forged as required workspace",
    value: {
      packages: cleanInventory.packages.map((entry) =>
        entry.name === "@happycastle/steel-managed-worker"
          ? {
              ...entry,
              contentSha256: "c".repeat(64),
              dependencyScope: "PRODUCTION",
              integrity: "sha512-forged",
              kind: "REGISTRY",
              sourceLocation: null,
            }
          : entry,
      ),
    },
  },
];

for (const mutation of inventoryMutations) {
  const result = evaluateProductionInventory({
    inventory: mutation.value,
    policy: inventoryPolicy,
  });
  assert.equal(result.decision, mutation.expected, mutation.name);
}

process.stdout.write(
  `${
    auditMutations.length + inventoryMutations.length
  } production audit mutations killed\n`,
);
