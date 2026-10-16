import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, lstat, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export async function checkReleaseArtifact(directory, expectedCommit) {
  assert.match(expectedCommit, /^[a-f0-9]{40}$/);
  const root = await realpath(directory);
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url)),
  );
  assert.equal(pkg.name, "glocon");
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/);
  const file = async (name) => {
    const path = resolve(root, name);
    assert.ok(
      (await realpath(path)).startsWith(root + sep),
      "Artifact path escapes its directory",
    );
    assert.ok(
      (await lstat(path)).isFile(),
      "Artifact inputs must be regular files",
    );
    return readFile(path);
  };
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const manifest = `${pkg.name}-${pkg.version}.release.json`;
  const evidence = JSON.parse(await file(manifest));
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.package, pkg.name);
  assert.equal(evidence.version, pkg.version);
  assert.equal(
    evidence.gitCommit,
    expectedCommit,
    "Candidate commit differs from this workflow",
  );
  assert.equal(evidence.status, "verified-local-candidate-unpublished");
  assert.match(evidence.sourceTreeSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.archive, `${pkg.name}-${pkg.version}.tgz`);
  assert.ok(Number.isSafeInteger(evidence.bytes) && evidence.bytes > 0);
  const archive = await file(evidence.archive);
  assert.equal(archive.length, evidence.bytes, "Candidate byte length differs");
  assert.equal(
    sha256(archive),
    evidence.archiveSha256,
    "Candidate SHA256 differs",
  );
  assert.equal(
    `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    evidence.integrity,
    "Candidate sha512 integrity differs",
  );
  const required = new Set([
    "check-all",
    "frameworks",
    "format",
    "minimum-runtime",
    "dependencies",
  ]);
  assert.ok(Array.isArray(evidence.validation?.tasks));
  const seen = new Set();
  let checks;
  for (const task of evidence.validation.tasks) {
    assert.equal(typeof task.name, "string");
    assert.ok(!seen.has(task.name), "Duplicate verification task");
    seen.add(task.name);
    required.delete(task.name);
    assert.equal(task.status, "passed", `Verification failed: ${task.name}`);
    assert.equal(task.exitCode, 0);
    assert.equal(task.signal, null);
    assert.equal(task.timedOut, false);
    assert.match(task.log, /^\.glocon\/release\/[a-zA-Z0-9-]+\.log$/);
    assert.match(task.logSha256, /^[a-f0-9]{64}$/);
    const bytes = await file(task.log);
    assert.equal(
      sha256(bytes),
      task.logSha256,
      `Verification log changed: ${task.name}`,
    );
    if (task.name === "check-all")
      checks = stripVTControlCharacters(bytes.toString("utf8"));
  }
  assert.equal(required.size, 0, "Required verification tasks are missing");
  const patterns = {
    node: /(?:#|ℹ)\s+tests\s+(\d+)/,
    unit: /Tests\s+(\d+) passed/,
    browser: /\b(\d+) passed \([\d.]+(?:ms|s|m|h)\)/,
  };
  for (const [suite, pattern] of Object.entries(patterns)) {
    const count = evidence.validation.tests?.[suite];
    assert.ok(
      Number.isSafeInteger(count) && count > 0,
      `Invalid ${suite} test count`,
    );
    assert.equal(
      Number(checks.match(pattern)?.[1]),
      count,
      `Recorded ${suite} count differs from its log`,
    );
  }
  return {
    archive: evidence.archive,
    manifest,
    version: pkg.version,
    gitCommit: expectedCommit,
    tests: evidence.validation.tests,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(
    process.argv.length,
    4,
    "Usage: node scripts/check-release-artifact.mjs <directory> <commit>",
  );
  const candidate = await checkReleaseArtifact(
    process.argv[2],
    process.argv[3],
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `archive=${candidate.archive}\nmanifest=${candidate.manifest}\nversion=${candidate.version}\n`,
    );
  console.log(JSON.stringify(candidate));
}
