import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import { hashDirectoryTree } from "./filesystem-tree.mjs";
import { DependencyScope, PackageKind } from "./inventory-policy.mjs";
import { isContainedPath, isSafeRelativePath } from "./path-boundary.mjs";
import { productionReachableLocations } from "./production-reachability.mjs";

const InstallMetadataDirectory = Object.freeze({
  BINARIES: ".bin",
  NESTED_MODULES: "node_modules",
});

export class InventoryGenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InventoryGenerationError";
  }
}

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const normalizeLocation = (rootDir, packageDir) =>
  relative(rootDir, packageDir).split(sep).join("/");

const packageDirectories = async (nodeModulesDir) => {
  const directories = [];
  const entries = (await readdir(nodeModulesDir, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (entry.name === InstallMetadataDirectory.BINARIES) continue;
    const entryPath = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scoped = (await readdir(entryPath, { withFileTypes: true })).sort(
        (left, right) => left.name.localeCompare(right.name),
      );
      for (const child of scoped) {
        if (child.isDirectory() || child.isSymbolicLink()) {
          directories.push(join(entryPath, child.name));
        }
      }
      continue;
    }
    if (entry.isDirectory() || entry.isSymbolicLink())
      directories.push(entryPath);
  }
  return directories;
};

const installedPackageName = (packageDir) => {
  const leaf = basename(packageDir);
  const parent = basename(dirname(packageDir));
  return parent.startsWith("@") ? `${parent}/${leaf}` : leaf;
};

const workspaceEntry = ({ installed, location, lockEntry, lockfile }) => {
  const source = lockfile.packages[lockEntry.resolved];
  if (
    lockEntry.link !== true ||
    typeof lockEntry.resolved !== "string" ||
    typeof source !== "object" ||
    source === null ||
    source.name !== installed.name ||
    source.version !== installed.version
  ) {
    throw new InventoryGenerationError(
      `${location} does not match package-lock workspace metadata`,
    );
  }
  return {
    contentSha256: null,
    dependencyScope: null,
    integrity: null,
    kind: PackageKind.WORKSPACE,
    location,
    name: installed.name,
    sourceLocation: lockEntry.resolved,
    version: installed.version,
  };
};

const registryEntry = async ({
  installed,
  location,
  lockEntry,
  packageRoot,
}) => {
  const expectedName = lockEntry.name ?? installedPackageName(packageRoot);
  if (
    installed.name !== expectedName ||
    lockEntry.version !== installed.version ||
    typeof lockEntry.integrity !== "string" ||
    !lockEntry.integrity.startsWith("sha512-")
  ) {
    throw new InventoryGenerationError(
      `${location} does not match package-lock registry metadata`,
    );
  }
  return {
    contentSha256: await hashDirectoryTree(packageRoot, {
      excludedDirectoryNames: [InstallMetadataDirectory.NESTED_MODULES],
    }),
    dependencyScope: null,
    integrity: lockEntry.integrity,
    kind: PackageKind.REGISTRY,
    location,
    name: installed.name,
    sourceLocation: null,
    version: installed.version,
  };
};

export const buildProductionInventory = async ({
  allowDevelopmentPackages = false,
  lockfile,
  productionWorkspaceSources,
  rootDir,
  scanRoots,
}) => {
  if (lockfile.lockfileVersion !== 3 || typeof lockfile.packages !== "object") {
    throw new InventoryGenerationError("package-lock v3 is required");
  }

  const packages = new Map();
  const sourceRoot = await realpath(rootDir);
  const scanNodeModules = async (nodeModulesDir) => {
    const scanStats = await lstat(nodeModulesDir);
    const canonicalScanRoot = await realpath(nodeModulesDir);
    if (
      scanStats.isSymbolicLink() ||
      !scanStats.isDirectory() ||
      !isContainedPath(sourceRoot, canonicalScanRoot)
    ) {
      throw new InventoryGenerationError("scan root escapes source root");
    }

    for (const packageDir of await packageDirectories(canonicalScanRoot)) {
      const location = normalizeLocation(sourceRoot, packageDir);
      const lockEntry = lockfile.packages[location];
      if (typeof lockEntry !== "object" || lockEntry === null) {
        throw new InventoryGenerationError(
          `${location} is installed but absent from package-lock`,
        );
      }
      const stats = await lstat(packageDir);
      const packageRoot = await realpath(packageDir);
      if (!isContainedPath(sourceRoot, packageRoot)) {
        throw new InventoryGenerationError(
          `${location} workspace link escapes source root`,
        );
      }
      const manifestPath = join(packageRoot, "package.json");
      if (!existsSync(manifestPath)) {
        throw new InventoryGenerationError(
          `${location} package manifest is missing`,
        );
      }
      const installed = await readJson(manifestPath);
      let entry;
      if (stats.isSymbolicLink()) {
        if (!isSafeRelativePath(lockEntry.resolved)) {
          throw new InventoryGenerationError(
            `${location} workspace link escapes source root or lock target`,
          );
        }
        const expectedTarget = await realpath(
          join(sourceRoot, lockEntry.resolved),
        );
        if (packageRoot !== expectedTarget) {
          throw new InventoryGenerationError(
            `${location} workspace link escapes source root or lock target`,
          );
        }
        entry = workspaceEntry({ installed, location, lockEntry, lockfile });
      } else {
        entry = await registryEntry({
          installed,
          location,
          lockEntry,
          packageRoot,
        });
      }
      packages.set(location, entry);

      const nested = join(packageRoot, InstallMetadataDirectory.NESTED_MODULES);
      if (!stats.isSymbolicLink() && existsSync(nested)) {
        await scanNodeModules(nested);
      }
    }
  };

  for (const scanRoot of scanRoots) {
    if (!isSafeRelativePath(scanRoot)) {
      throw new InventoryGenerationError("scan roots must stay inside rootDir");
    }
    const nodeModulesDir = join(sourceRoot, scanRoot);
    if (existsSync(nodeModulesDir)) await scanNodeModules(nodeModulesDir);
  }

  const reachable = productionReachableLocations({
    installedPackages: [...packages.values()],
    lockfile,
    workspaceSources: productionWorkspaceSources,
  });
  const classified = [...packages.values()].map((entry) =>
    entry.kind === PackageKind.REGISTRY
      ? {
          ...entry,
          dependencyScope: reachable.has(entry.location)
            ? DependencyScope.PRODUCTION
            : DependencyScope.DEVELOPMENT,
        }
      : entry,
  );
  const development = classified.find(
    (entry) => entry.dependencyScope === DependencyScope.DEVELOPMENT,
  );
  if (!allowDevelopmentPackages && development !== undefined) {
    throw new InventoryGenerationError(
      `${development.location} is unreachable from production workspaces`,
    );
  }
  return {
    packages: classified.sort((left, right) =>
      left.location.localeCompare(right.location),
    ),
  };
};
