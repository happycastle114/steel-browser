import { builtinModules } from "node:module";
import type { RollupOutput, RollupWatcher } from "rollup";
import { build } from "vite";

const FORBIDDEN_BARE_BUILTINS = new Set(
  builtinModules.map((name) => name.replace(/^node:/u, "")),
);

const ROLLUP_OUTPUT_KIND = { CHUNK: "chunk" } as const;

class BrowserBundleVerificationError extends Error {
  public override readonly name = "BrowserBundleVerificationError";
}

function isWatcher(
  value: RollupOutput | RollupWatcher,
): value is RollupWatcher {
  return "close" in value && !("output" in value);
}

function emittedCode(
  result: RollupOutput | RollupOutput[] | RollupWatcher,
): string {
  const outputs = Array.isArray(result) ? result : [result];
  const code: string[] = [];
  for (const output of outputs) {
    if (isWatcher(output))
      throw new BrowserBundleVerificationError("unexpected watch build");
    for (const item of output.output) {
      if (item.type === ROLLUP_OUTPUT_KIND.CHUNK) code.push(item.code);
    }
  }
  return code.join("\n");
}

const result = await build({
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "forbid-node-builtins",
      resolveId(source) {
        if (source.startsWith("node:") || FORBIDDEN_BARE_BUILTINS.has(source)) {
          throw new BrowserBundleVerificationError(
            `forbidden Node builtin in browser graph: ${source}`,
          );
        }
        return null;
      },
    },
  ],
  build: {
    write: false,
    lib: {
      entry: new URL("../src/index.ts", import.meta.url).pathname,
      formats: ["es"],
    },
  },
});

const code = emittedCode(result);
if (code.includes("__vite-browser-external") || code.includes("node:")) {
  throw new BrowserBundleVerificationError(
    "browser bundle contains an externalized Node builtin",
  );
}
