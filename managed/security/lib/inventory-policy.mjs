export const InventoryDecision = Object.freeze({
  BLOCK: "BLOCK",
  INVALID: "INVALID",
  PASS: "PASS",
});

export const PackageKind = Object.freeze({
  REGISTRY: "REGISTRY",
  WORKSPACE: "WORKSPACE",
});

export const DependencyScope = Object.freeze({
  DEVELOPMENT: "DEVELOPMENT",
  PRODUCTION: "PRODUCTION",
});

const packageKinds = new Set(Object.values(PackageKind));
const dependencyScopes = new Set(Object.values(DependencyScope));
const sha256Pattern = /^[a-f0-9]{64}$/u;

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPackage = (entry) => {
  if (!isRecord(entry)) return false;
  if (
    typeof entry.location !== "string" ||
    typeof entry.name !== "string" ||
    typeof entry.version !== "string" ||
    !packageKinds.has(entry.kind)
  ) {
    return false;
  }

  switch (entry.kind) {
    case PackageKind.REGISTRY:
      return (
        entry.sourceLocation === null &&
        typeof entry.integrity === "string" &&
        entry.integrity.startsWith("sha512-") &&
        dependencyScopes.has(entry.dependencyScope) &&
        typeof entry.contentSha256 === "string" &&
        sha256Pattern.test(entry.contentSha256)
      );
    case PackageKind.WORKSPACE:
      return (
        entry.integrity === null &&
        entry.contentSha256 === null &&
        entry.dependencyScope === null &&
        typeof entry.sourceLocation === "string" &&
        !entry.sourceLocation.startsWith("/") &&
        !entry.sourceLocation.split("/").includes("..")
      );
    default:
      return false;
  }
};

export const evaluateProductionInventory = ({ inventory, policy }) => {
  if (
    !isRecord(inventory) ||
    !Array.isArray(inventory.packages) ||
    !isRecord(policy) ||
    !Array.isArray(policy.forbiddenPackages) ||
    !Array.isArray(policy.requiredWorkspaces) ||
    !isRecord(policy.workspaceSources) ||
    !inventory.packages.every(isPackage)
  ) {
    return { decision: InventoryDecision.INVALID };
  }

  const locations = inventory.packages.map((entry) => entry.location);
  if (new Set(locations).size !== locations.length) {
    return { decision: InventoryDecision.INVALID };
  }

  const names = new Set(inventory.packages.map((entry) => entry.name));
  const workspaces = inventory.packages.filter(
    (entry) => entry.kind === PackageKind.WORKSPACE,
  );
  const missingWorkspaces = policy.requiredWorkspaces
    .filter(
      (name) =>
        !workspaces.some(
          (entry) =>
            entry.name === name &&
            entry.sourceLocation === policy.workspaceSources[name],
        ),
    )
    .sort();
  const forbiddenPackages = policy.forbiddenPackages
    .filter((name) => names.has(name))
    .sort();
  const developmentPackages = inventory.packages
    .filter((entry) => entry.dependencyScope === DependencyScope.DEVELOPMENT)
    .map((entry) => entry.location)
    .sort();
  const invalidWorkspaceSources = workspaces
    .filter(
      (entry) => policy.workspaceSources[entry.name] !== entry.sourceLocation,
    )
    .map((entry) => entry.name)
    .sort();

  if (
    missingWorkspaces.length > 0 ||
    forbiddenPackages.length > 0 ||
    developmentPackages.length > 0 ||
    invalidWorkspaceSources.length > 0
  ) {
    return {
      decision: InventoryDecision.BLOCK,
      developmentPackages,
      forbiddenPackages,
      invalidWorkspaceSources,
      missingWorkspaces,
    };
  }

  return { decision: InventoryDecision.PASS };
};
