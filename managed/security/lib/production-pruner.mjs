import { lstat, realpath, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DependencyScope, PackageKind } from "./inventory-policy.mjs";
import { isContainedPath } from "./path-boundary.mjs";

export class ProductionPruneError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionPruneError";
  }
}

export const pruneNonProductionPackages = async ({
  inventory,
  policy,
  rootDir,
}) => {
  const sourceRoot = await realpath(rootDir);
  if (dirname(sourceRoot) === sourceRoot) {
    throw new ProductionPruneError("filesystem root cannot be pruned");
  }
  const forbidden = new Set(policy.forbiddenPackages);
  const targets = inventory.packages
    .filter(
      (entry) =>
        forbidden.has(entry.name) ||
        entry.dependencyScope === DependencyScope.DEVELOPMENT,
    )
    .sort(
      (left, right) =>
        right.location.split("/").length - left.location.split("/").length ||
        left.location.localeCompare(right.location),
    );

  for (const target of targets) {
    if (target.kind !== PackageKind.REGISTRY) {
      throw new ProductionPruneError("workspace packages cannot be pruned");
    }
    const packagePath = resolve(sourceRoot, target.location);
    if (!isContainedPath(sourceRoot, packagePath)) {
      throw new ProductionPruneError("prune target escapes source root");
    }
    const stats = await lstat(packagePath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ProductionPruneError(
        "prune target must be a registry directory",
      );
    }
    const packageRoot = await realpath(packagePath);
    if (!isContainedPath(sourceRoot, packageRoot)) {
      throw new ProductionPruneError("prune target escapes source root");
    }
    await rm(packagePath, { recursive: true });
  }

  return targets.map(({ location, name, version }) => ({
    location,
    name,
    version,
  }));
};
