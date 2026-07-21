import { isAbsolute, relative, sep } from "node:path";

export const isContainedPath = (root, candidate) => {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot !== "" &&
    !isAbsolute(fromRoot) &&
    !fromRoot.split(sep).includes("..")
  );
};

export const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !isAbsolute(value) &&
  !value.split("/").includes("..");
