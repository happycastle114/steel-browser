#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNativeOverlayEvidence } from "./lib/native-overlay.mjs";
import { canonicalJsonBytes } from "./lib/receipt.mjs";
import {
  isProductionTarget,
  productionTargetPolicy,
} from "./lib/production-target.mjs";

const Flag = Object.freeze({
  BUILDER_ROOT: "--builder-root",
  INSTALLED_ROOT: "--installed-root",
  OUTPUT: "--output",
  POLICY: "--policy",
  TARGET: "--target",
});

const knownFlags = new Set(Object.values(Flag));
const defaultPolicyPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "production-audit-policy.json",
);

class NativeOverlayCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "NativeOverlayCliError";
  }
}

const parseArguments = (argv) => {
  if (argv.length % 2 !== 0) {
    throw new NativeOverlayCliError("every flag requires one value");
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
      throw new NativeOverlayCliError("unknown, duplicate, or empty argument");
    }
    values.set(flag, value);
  }
  const required = [
    Flag.BUILDER_ROOT,
    Flag.INSTALLED_ROOT,
    Flag.OUTPUT,
    Flag.TARGET,
  ];
  if (required.some((flag) => !values.has(flag))) {
    throw new NativeOverlayCliError("required native overlay argument missing");
  }
  return values;
};

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
    throw new NativeOverlayCliError("target must be WORKER or MANAGER");
  }
  const policyPath = resolve(args.get(Flag.POLICY) ?? defaultPolicyPath);
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const targetPolicy = productionTargetPolicy(policy, target);
  if (targetPolicy === undefined) {
    throw new NativeOverlayCliError("target policy is missing");
  }
  const evidence = await buildNativeOverlayEvidence({
    builderRoot: resolve(args.get(Flag.BUILDER_ROOT)),
    expected: targetPolicy.nativeOverlays,
    installedRoot: resolve(args.get(Flag.INSTALLED_ROOT)),
  });
  await writeAtomic(
    resolve(args.get(Flag.OUTPUT)),
    canonicalJsonBytes(evidence),
  );
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`native overlay evidence failed: ${message}\n`);
  process.exitCode = 1;
});
