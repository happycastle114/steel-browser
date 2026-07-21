import { posix } from "node:path";

import { PackageKind } from "./inventory-policy.mjs";

const DependencyRequirement = Object.freeze({
  OPTIONAL: "OPTIONAL",
  REQUIRED: "REQUIRED",
});

export class ProductionReachabilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionReachabilityError";
  }
}

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dependencyRequirements = (lockEntry) => {
  const requirements = new Map();
  for (const name of Object.keys(lockEntry.dependencies ?? {})) {
    requirements.set(name, DependencyRequirement.REQUIRED);
  }
  for (const name of Object.keys(lockEntry.optionalDependencies ?? {})) {
    requirements.set(name, DependencyRequirement.OPTIONAL);
  }
  for (const name of Object.keys(lockEntry.peerDependencies ?? {})) {
    const optional = lockEntry.peerDependenciesMeta?.[name]?.optional === true;
    requirements.set(
      name,
      optional
        ? DependencyRequirement.OPTIONAL
        : DependencyRequirement.REQUIRED,
    );
  }
  return requirements;
};

const resolveInstalledDependency = ({ installed, name, requester }) => {
  let current = requester;
  while (current !== ".") {
    const candidate = posix.join(current, "node_modules", name);
    if (installed.has(candidate)) return installed.get(candidate);
    let parent = posix.dirname(current);
    if (posix.basename(parent) === "node_modules") {
      parent = posix.dirname(parent);
    }
    if (parent === current) break;
    current = parent;
  }
  return installed.get(posix.join("node_modules", name));
};

export const productionReachableLocations = ({
  installedPackages,
  lockfile,
  workspaceSources,
}) => {
  if (
    !Array.isArray(workspaceSources) ||
    workspaceSources.length === 0 ||
    !workspaceSources.every((source) => typeof source === "string")
  ) {
    throw new ProductionReachabilityError(
      "production workspace sources are required",
    );
  }
  const installed = new Map(
    installedPackages.map((entry) => [entry.location, entry]),
  );
  const reachable = new Set();
  const visited = new Set();
  const queue = [...workspaceSources];

  while (queue.length > 0) {
    const requester = queue.shift();
    if (visited.has(requester)) continue;
    visited.add(requester);
    const lockEntry = lockfile.packages[requester];
    if (!isRecord(lockEntry)) {
      throw new ProductionReachabilityError(
        `${requester} production root is absent from package-lock`,
      );
    }

    for (const [name, requirement] of dependencyRequirements(lockEntry)) {
      const dependency = resolveInstalledDependency({
        installed,
        name,
        requester,
      });
      if (dependency === undefined) {
        if (requirement === DependencyRequirement.OPTIONAL) continue;
        throw new ProductionReachabilityError(
          `${requester} required dependency ${name} is not installed`,
        );
      }
      if (dependency.kind === PackageKind.WORKSPACE) {
        queue.push(dependency.sourceLocation);
        continue;
      }
      reachable.add(dependency.location);
      queue.push(dependency.location);
    }
  }

  return reachable;
};
