#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProductionInventory } from "./lib/inventory-generator.mjs";
import { pruneNonProductionPackages } from "./lib/production-pruner.mjs";
import { canonicalJsonBytes } from "./lib/receipt.mjs";
import {
  isProductionTarget,
  productionTargetPolicy,
} from "./lib/production-target.mjs";

const Flag = Object.freeze({
  POLICY: "--policy",
  ROOT: "--root",
  TARGET: "--target",
});

const knownFlags = new Set(Object.values(Flag));
const defaultPolicyPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "production-audit-policy.json",
);

class ProductionPruneCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionPruneCliError";
  }
}

const parseArguments = (argv) => {
  if (argv.length % 2 !== 0) {
    throw new ProductionPruneCliError("every flag requires one value");
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
      throw new ProductionPruneCliError("invalid production prune argument");
    }
    values.set(flag, value);
  }
  if (!values.has(Flag.ROOT) || !values.has(Flag.TARGET)) {
    throw new ProductionPruneCliError("root and target are required");
  }
  return values;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  const target = args.get(Flag.TARGET);
  if (!isProductionTarget(target)) {
    throw new ProductionPruneCliError("target must be WORKER or MANAGER");
  }
  const rootDir = resolve(args.get(Flag.ROOT));
  const policyPath = resolve(args.get(Flag.POLICY) ?? defaultPolicyPath);
  const [policy, lockfile] = await Promise.all([
    readJson(policyPath),
    readJson(join(rootDir, "package-lock.json")),
  ]);
  const targetPolicy = productionTargetPolicy(policy, target);
  if (targetPolicy === undefined) {
    throw new ProductionPruneCliError("target policy is missing");
  }
  const inventory = await buildProductionInventory({
    allowDevelopmentPackages: true,
    lockfile,
    productionWorkspaceSources: Object.values(targetPolicy.workspaceSources),
    rootDir,
    scanRoots: targetPolicy.scanRoots,
  });
  const removed = await pruneNonProductionPackages({
    inventory,
    policy: targetPolicy,
    rootDir,
  });
  process.stdout.write(canonicalJsonBytes({ removed }));
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`production prune failed: ${message}\n`);
  process.exitCode = 1;
});
