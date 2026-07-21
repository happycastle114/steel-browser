#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProductionInventory } from "./lib/inventory-generator.mjs";
import {
  buildProductionAuditReceipt,
  canonicalJsonBytes,
  sha256Hex,
} from "./lib/receipt.mjs";
import {
  isProductionTarget,
  productionTargetPolicy,
} from "./lib/production-target.mjs";

const Flag = Object.freeze({
  AUDIT: "--audit",
  AUDIT_OBSERVED_AT: "--audit-observed-at",
  NATIVE_OVERLAYS: "--native-overlays",
  OUTPUT: "--output",
  POLICY: "--policy",
  ROOT: "--root",
  SOURCE_REVISION: "--source-revision",
  SOURCE_TREE_SHA256: "--source-tree-sha256",
  TARGET: "--target",
});

const knownFlags = new Set(Object.values(Flag));
const defaultPolicyPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "production-audit-policy.json",
);

class ProductionAuditCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionAuditCliError";
  }
}

const parseArguments = (argv) => {
  if (argv.length % 2 !== 0) {
    throw new ProductionAuditCliError("every flag requires one value");
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !knownFlags.has(flag) ||
      values.has(flag) ||
      typeof value !== "string" ||
      value.length === 0
    ) {
      throw new ProductionAuditCliError(
        "unknown, duplicate, or empty argument",
      );
    }
    values.set(flag, value);
  }

  const required = [
    Flag.AUDIT,
    Flag.AUDIT_OBSERVED_AT,
    Flag.NATIVE_OVERLAYS,
    Flag.OUTPUT,
    Flag.SOURCE_REVISION,
    Flag.SOURCE_TREE_SHA256,
    Flag.TARGET,
  ];
  if (required.some((flag) => !values.has(flag))) {
    throw new ProductionAuditCliError(
      "required production audit argument missing",
    );
  }
  return values;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const writeAtomic = async (path, bytes) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.tmp`,
  );
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
};

const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  const target = args.get(Flag.TARGET);
  if (!isProductionTarget(target)) {
    throw new ProductionAuditCliError("target must be WORKER or MANAGER");
  }

  const rootDir = resolve(args.get(Flag.ROOT) ?? process.cwd());
  const policyPath = resolve(args.get(Flag.POLICY) ?? defaultPolicyPath);
  const auditPath = resolve(args.get(Flag.AUDIT));
  const overlayPath = resolve(args.get(Flag.NATIVE_OVERLAYS));
  const outputPath = resolve(args.get(Flag.OUTPUT));
  const lockfilePath = join(rootDir, "package-lock.json");

  const [policy, auditBytes, lockfileBytes, nativeOverlays] = await Promise.all(
    [
      readJson(policyPath),
      readFile(auditPath),
      readFile(lockfilePath),
      readJson(overlayPath),
    ],
  );
  const audit = JSON.parse(auditBytes.toString("utf8"));
  const lockfile = JSON.parse(lockfileBytes.toString("utf8"));
  const targetPolicy = productionTargetPolicy(policy, target);
  if (targetPolicy === undefined) {
    throw new ProductionAuditCliError("target policy is missing");
  }

  const inventory = await buildProductionInventory({
    lockfile,
    productionWorkspaceSources: Object.values(targetPolicy.workspaceSources),
    rootDir,
    scanRoots: targetPolicy.scanRoots,
  });
  const npmVersion = execFileSync("npm", ["--version"], {
    encoding: "utf8",
  }).trim();
  const receipt = buildProductionAuditReceipt({
    audit,
    auditBytes,
    auditObservedAt: args.get(Flag.AUDIT_OBSERVED_AT),
    inventory,
    lockfileBytes,
    nativeOverlays,
    npmVersion,
    policy,
    sourceRevision: args.get(Flag.SOURCE_REVISION),
    sourceTreeSha256: args.get(Flag.SOURCE_TREE_SHA256),
    target,
    targetPolicy,
  });
  const receiptBytes = canonicalJsonBytes(receipt);
  await writeAtomic(outputPath, receiptBytes);
  process.stdout.write(
    `${JSON.stringify({ receiptSha256: sha256Hex(receiptBytes) })}\n`,
  );
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`production audit failed: ${message}\n`);
  process.exitCode = 1;
});
