import { readFile, readdir, readlink, realpath, lstat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { canonicalJson, sha256Hex } from "./receipt.mjs";
import { isContainedPath } from "./path-boundary.mjs";

const EntryType = Object.freeze({
  DIRECTORY: "DIRECTORY",
  FILE: "FILE",
  SYMLINK: "SYMLINK",
});

export class FilesystemTreeError extends Error {
  constructor(message) {
    super(message);
    this.name = "FilesystemTreeError";
  }
}

const normalizedPath = (root, path) =>
  relative(root, path).split(sep).join("/");

export const hashDirectoryTree = async (
  root,
  { excludedDirectoryNames = [] } = {},
) => {
  const canonicalRoot = await realpath(root);
  const excluded = new Set(excludedDirectoryNames);
  const entries = [];

  const visit = async (directory) => {
    const children = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const child of children) {
      if (child.isDirectory() && excluded.has(child.name)) continue;
      const path = join(directory, child.name);
      const stats = await lstat(path);
      const base = {
        mode: stats.mode & 0o7777,
        path: normalizedPath(canonicalRoot, path),
      };
      if (stats.isDirectory()) {
        entries.push({
          ...base,
          contentSha256: null,
          target: null,
          type: EntryType.DIRECTORY,
        });
        await visit(path);
        continue;
      }
      if (stats.isFile()) {
        entries.push({
          ...base,
          contentSha256: sha256Hex(await readFile(path)),
          target: null,
          type: EntryType.FILE,
        });
        continue;
      }
      if (stats.isSymbolicLink()) {
        const target = await readlink(path);
        const lexicalTarget = resolve(dirname(path), target);
        const resolvedTarget = await realpath(path);
        if (
          !isContainedPath(canonicalRoot, lexicalTarget) ||
          !isContainedPath(canonicalRoot, resolvedTarget)
        ) {
          throw new FilesystemTreeError("filesystem tree symlink escapes root");
        }
        entries.push({
          ...base,
          contentSha256: null,
          target,
          type: EntryType.SYMLINK,
        });
        continue;
      }
      throw new FilesystemTreeError("unsupported filesystem tree entry");
    }
  };

  await visit(canonicalRoot);
  return sha256Hex(Buffer.from(canonicalJson(entries), "utf8"));
};
