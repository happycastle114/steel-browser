import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import AdmZip from "adm-zip";
import { Database } from "duckdb-async";
import { FingerprintGenerator } from "fingerprint-generator";

const require = createRequire(import.meta.url);

const packageVersion = (name) => require(`${name}/package.json`).version;

test("uses the audited production dependency versions", () => {
  // Given the installed production dependency graph.
  const versions = {
    admZip: packageVersion("adm-zip"),
    nodeGyp: packageVersion("node-gyp"),
    tar: packageVersion("tar"),
  };

  // When inspected, then the security-patched overrides are exact.
  assert.deepEqual(versions, {
    admZip: "0.6.0",
    nodeGyp: "12.4.0",
    tar: "7.5.20",
  });
});

test("keeps the adm-zip API used by fingerprint generation compatible", () => {
  // Given the overridden adm-zip implementation.
  const archive = new AdmZip();
  archive.addFile("fixture.txt", Buffer.from("compatible", "utf8"));

  // When its public read/write API is exercised.
  const value = archive.readAsText("fixture.txt");
  const generated = new FingerprintGenerator().getFingerprint();

  // Then both the direct API and consuming package remain operational.
  assert.equal(value, "compatible");
  assert.ok(generated.fingerprint);
  assert.ok(generated.headers);
});

test("loads the built DuckDB native module with the node-gyp override", async () => {
  // Given the installed native DuckDB package.
  const database = await Database.create(":memory:");

  // When a real query crosses the native module boundary.
  const rows = await database.all("select 42 as answer");
  await database.close();

  // Then the native artifact is usable, not merely present.
  assert.equal(rows[0]?.answer, 42);
});
