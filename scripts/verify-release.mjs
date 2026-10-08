import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const args = new Set(process.argv.slice(2));
for (const arg of args)
  if (arg !== "--extended")
    throw Error(`Unknown release verification option: ${arg}`);
const directory = join(root, ".glocon", "release");
await mkdir(directory, { recursive: true });
const manifestPath = join(root, `glocon-${pkg.version}.release.json`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...argv) =>
  execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();

async function sourceHash() {
  const files = [
    ...new Set(
      git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split(
        "\0",
      ),
    ),
  ]
    .filter((file) => file && resolve(root, file) !== manifestPath)
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = await readFile(join(root, file));
    hash
      .update(file)
      .update("\0")
      .update(String(bytes.length))
      .update("\0")
      .update(bytes);
  }
  return hash.digest("hex");
}

const evidence = {
  schemaVersion: 1,
  package: pkg.name,
  version: pkg.version,
  status: "validation-in-progress",
  recordedOn: new Date().toISOString(),
  gitCommit: git("rev-parse", "HEAD"),
  gitBranch: git("branch", "--show-current"),
  worktreeChangesNotCommitted: Boolean(git("status", "--porcelain")),
  sourceTreeSha256: await sourceHash(),
  sourceHashDefinition:
    "SHA256 of sorted tracked and nonignored untracked paths, each path NUL byte-length NUL bytes; excludes this manifest.",
  validation: { node: process.version, tasks: [] },
  externalGates: [
    "Publish this tested source and archive using an authorized npm account or configured trusted publisher, then run check:distribution.",
    "Complete and review independent real-application UI and financial trials; automated fixtures are not independent-user evidence.",
  ],
};
async function save() {
  await writeFile(manifestPath, JSON.stringify(evidence, null, 2) + "\n");
}
await save();

async function check(name, executable, argv, timeout = 1200000) {
  const filename = `${name.replace(/[^a-z0-9-]/gi, "-")}.log`;
  const path = join(directory, filename);
  const log = createWriteStream(path);
  const task = {
    name,
    command: [executable, ...argv],
    startedAt: new Date().toISOString(),
    status: "running",
    log: `.glocon/release/${filename}`,
  };
  evidence.validation.tasks.push(task);
  await save();
  console.log(`Verifying ${name}; log: ${task.log}`);
  const child = spawn(executable, argv, {
    cwd: root,
    shell: process.platform === "win32" && executable === "npm",
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let expired = false;
  const terminate = () => {
    if (!child.pid) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  };
  const interrupted = () => terminate();
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  const timer = setTimeout(() => {
    expired = true;
    terminate();
  }, timeout);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } catch (error) {
    result = { code: null, signal: null, error: error.message };
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    await new Promise((resolve) => log.end(resolve));
  }
  const bytes = await readFile(path);
  Object.assign(task, {
    finishedAt: new Date().toISOString(),
    status: result.code === 0 && !expired ? "passed" : "failed",
    exitCode: result.code,
    signal: result.signal,
    timedOut: expired,
    logSha256: sha(bytes),
    ...(result.error ? { error: result.error } : {}),
  });
  await save();
  if (task.status !== "passed")
    throw Error(`${name} failed; inspect ${task.log}`);
  console.log(`${name} passed`);
  return bytes.toString("utf8");
}

try {
  const all = await check("check-all", "npm", ["run", "check:all"]);
  evidence.validation.tests = {
    node: Number(all.match(/# tests (\d+)/)?.[1] ?? 0),
    unit: Number(all.match(/Tests\s+(\d+) passed/)?.[1] ?? 0),
    browser: Number(all.match(/\b(\d+) passed \([\d.]+s\)/)?.[1] ?? 0),
  };
  await check("frameworks", "npm", ["run", "test:frameworks"]);
  await check("format", "npm", ["run", "format:check"]);
  const minimum = pkg.engines.node.match(/^>=(\d+\.\d+\.\d+)$/)?.[1];
  if (!minimum)
    throw Error(
      "Release verification requires an explicit minimum Node version.",
    );
  await check("minimum-runtime", "npm", [
    "exec",
    "--yes",
    `--package=node@${minimum}`,
    "--package=npm@9.9.4",
    "--",
    "node",
    "scripts/check-minimum-runtime.mjs",
  ]);
  const audit = JSON.parse(
    await check("dependencies", "npm", ["audit", "--json"]),
  );
  evidence.validation.dependencies = audit.metadata.vulnerabilities;
  if (args.has("--extended")) {
    await check("browser-matrix", "npm", ["run", "test:browser:matrix"]);
    await check("package-managers", process.execPath, [
      "scripts/check-managers.mjs",
    ]);
    if (process.platform === "linux")
      await check("electron", "xvfb-run", [
        "--auto-servernum",
        "npm",
        "run",
        "test:electron",
      ]);
  }
  if ((await sourceHash()) !== evidence.sourceTreeSha256)
    throw Error(
      "Source files changed during verification; rerun against the final source tree.",
    );
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    }),
  )[0];
  const archive = await readFile(join(root, packed.filename));
  Object.assign(evidence, {
    status: "verified-local-candidate-unpublished",
    completedAt: new Date().toISOString(),
    archive: packed.filename,
    bytes: archive.length,
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    archiveSha256: sha(archive),
    verificationScope: args.has("--extended")
      ? "local-plus-browser-package-manager-electron-matrices"
      : "local-core-browser-packaging-frameworks-minimum-runtime",
    note: "Only checks executed by this run are recorded as passed. Android, other desktop operating systems, independent-user trials and public publication require separate current evidence. Logs are local and gitignored.",
  });
  await save();
  console.log(`Verified ${packed.filename}; evidence: ${manifestPath}`);
} catch (error) {
  evidence.status = "validation-failed";
  evidence.failure = error.message;
  await save();
  throw error;
}
