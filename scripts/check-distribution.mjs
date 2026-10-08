import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const exec = promisify(execFile);
const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => arg === "--verified-candidate"),
  "Only --verified-candidate is supported",
);
let candidate;
if (args.includes("--verified-candidate")) {
  candidate = JSON.parse(
    await readFile(
      new URL(`../glocon-${manifest.version}.release.json`, import.meta.url),
      "utf8",
    ),
  );
  assert.equal(candidate.package, manifest.name);
  assert.equal(candidate.version, manifest.version);
  assert.equal(candidate.status, "verified-local-candidate-unpublished");
  assert.ok(candidate.validation.tasks.length > 0);
  assert.ok(
    candidate.validation.tasks.every((task) => task.status === "passed"),
  );
  assert.equal(candidate.archive, `${manifest.name}-${manifest.version}.tgz`);
  const archive = await readFile(
    new URL(`../${candidate.archive}`, import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(archive).digest("hex"),
    candidate.archiveSha256,
  );
  assert.equal(
    `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    candidate.integrity,
  );
}
const registry = "https://registry.npmjs.org";
const response = await fetch(`${registry}/${manifest.name}`, {
  signal: AbortSignal.timeout(30000),
});
assert.ok(response.ok, `Registry metadata request failed: ${response.status}`);
const metadata = await response.json();
assert.equal(
  metadata["dist-tags"].latest,
  manifest.version,
  `Public latest is ${metadata["dist-tags"].latest}; local ${manifest.version} is not the default install. Publish this release and set its latest tag before announcing the default install.`,
);
const release = metadata.versions[manifest.version];
assert.ok(release, "Current version is missing from the public registry");
const tarballURL = new URL(release.dist.tarball);
assert.equal(tarballURL.origin, registry, "Unexpected public tarball origin");
const download = await fetch(tarballURL, {
  signal: AbortSignal.timeout(30000),
});
assert.ok(download.ok, `Tarball request failed: ${download.status}`);
const bytes = Buffer.from(await download.arrayBuffer());
const integrity = release.dist.integrity;
assert.match(integrity, /^sha512-[A-Za-z0-9+/=]+$/);
assert.equal(
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  integrity,
  "Registry tarball integrity mismatch",
);
if (candidate) {
  assert.equal(
    integrity,
    candidate.integrity,
    "Public archive differs from the locally tested release candidate",
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    candidate.archiveSha256,
  );
}
const directory = await mkdtemp(join(tmpdir(), "glocon-public-install-"));
try {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "public-install-check",
      private: true,
      type: "module",
    }),
  );
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry",
      registry,
      "glocon",
    ],
    { cwd: directory },
  );
  const installed = JSON.parse(
    await readFile(join(directory, "node_modules/glocon/package.json"), "utf8"),
  );
  assert.equal(installed.version, manifest.version);
  const smoke = `import assert from 'node:assert/strict'; import {createComplianceExample, calculateOrder, createInvoiceDraft, checkFinancialCases} from 'glocon/compliance'; const sample=createComplianceExample('JP'); const quote=calculateOrder(sample.config,sample.order); assert.equal(quote.status,'ready'); assert.equal(quote.value.gross,'2200'); assert.equal(createInvoiceDraft(sample.config,sample.order,sample.details).status,'ready'); assert.equal(checkFinancialCases(sample.config,[{name:'invoice',order:sample.order,details:sample.details,expected:{status:'ready',net:'2000',tax:'200',gross:'2200'}}]).exitCode,0);`;
  await exec(process.execPath, ["--input-type=module", "-e", smoke], {
    cwd: directory,
  });
  const cli = resolve(directory, "node_modules/glocon/bin/glocon.mjs");
  assert.equal(
    (await exec(process.execPath, [cli, "--version"])).stdout.trim(),
    manifest.version,
  );
  await exec(process.execPath, [
    cli,
    "compliance",
    "init",
    "--country",
    "JP",
    "--demo",
    "--dir",
    directory,
  ]);
  await exec(process.execPath, [
    cli,
    "compliance",
    "check",
    "--dir",
    directory,
  ]);
  console.log(
    `Verified public latest ${manifest.version}, sha512 integrity${candidate ? ", exact tested archive" : ""}, fresh npm install, financial exports and CLI workflow.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
