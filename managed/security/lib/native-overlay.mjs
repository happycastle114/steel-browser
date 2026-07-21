import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import {
  FilesystemTreeError,
  hashDirectoryTree as hashFilesystemTree,
} from "./filesystem-tree.mjs";
import { isContainedPath, isSafeRelativePath } from "./path-boundary.mjs";

export class NativeOverlayError extends Error {
  constructor(message) {
    super(message);
    this.name = "NativeOverlayError";
  }
}

export const hashDirectoryTree = async (root) => {
  try {
    return await hashFilesystemTree(root);
  } catch (error) {
    if (error instanceof FilesystemTreeError) {
      throw new NativeOverlayError("native overlay filesystem tree is invalid");
    }
    throw error;
  }
};

const resolvePackageRoot = async (root, location) => {
  const canonicalRoot = await realpath(root);
  const packagePath = join(canonicalRoot, location);
  const stats = await lstat(packagePath);
  const packageRoot = await realpath(packagePath);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !isContainedPath(canonicalRoot, packageRoot)
  ) {
    throw new NativeOverlayError("native overlay package escapes root");
  }
  return packageRoot;
};

const readManifest = async (packageRoot) =>
  JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

export const buildNativeOverlayEvidence = async ({
  builderRoot,
  expected,
  installedRoot,
}) => {
  const evidence = [];
  for (const overlay of expected) {
    if (!isSafeRelativePath(overlay.location)) {
      throw new NativeOverlayError("native overlay location escapes root");
    }
    const [builderPackageRoot, installedPackageRoot] = await Promise.all([
      resolvePackageRoot(builderRoot, overlay.location),
      resolvePackageRoot(installedRoot, overlay.location),
    ]);
    const [builderManifest, installedManifest] = await Promise.all([
      readManifest(builderPackageRoot),
      readManifest(installedPackageRoot),
    ]);
    if (
      builderManifest.name !== overlay.name ||
      builderManifest.version !== overlay.version ||
      installedManifest.name !== overlay.name ||
      installedManifest.version !== overlay.version
    ) {
      throw new NativeOverlayError(
        "native overlay identity differs from policy",
      );
    }

    const [builderTreeSha256, installedTreeSha256] = await Promise.all([
      hashDirectoryTree(builderPackageRoot),
      hashDirectoryTree(installedPackageRoot),
    ]);
    if (builderTreeSha256 !== installedTreeSha256) {
      throw new NativeOverlayError("native overlay trees differ");
    }
    evidence.push({
      builderTreeSha256,
      installedTreeSha256,
      location: overlay.location,
      name: overlay.name,
      version: overlay.version,
    });
  }
  return evidence;
};
