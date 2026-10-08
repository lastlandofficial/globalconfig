import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";

const serial = process.env.GLOCON_NATIVE_SERIAL;
if (!serial?.startsWith("emulator-"))
  throw Error(
    "Set GLOCON_NATIVE_SERIAL to a disposable Android emulator serial; physical devices are not selected automatically.",
  );
const apk = process.env.GLOCON_EXPO_GO_APK;
if (!apk)
  throw Error(
    "Set GLOCON_EXPO_GO_APK to the Expo Go 57.0.9 APK from the official Expo release.",
  );
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13))
  throw Error("The Expo 57 verification tools require Node 22.13 or later.");
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "glocon-native-"));
const app = join(temp, "app");
const events = [];
let metro;
let metroOutput = "";
const reverses = [];
const adb = (...args) =>
  exec("adb", ["-s", serial, ...args], { timeout: 120000, maxBuffer: 8e6 });
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    try {
      events.push(JSON.parse(body));
      response.end("ok");
    } catch {
      response.statusCode = 400;
      response.end();
    }
  });
});
async function until(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const fatal = events.find((event) => event.kind === "fatal");
    if (fatal) throw Error(`Native runtime failed: ${fatal.value}`);
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error(`Timed out: ${label}\n${metroOutput.slice(-12000)}`);
}
async function tap(label) {
  await adb("shell", "uiautomator", "dump", "/sdcard/glocon-ui.xml");
  const xml = (await adb("shell", "cat", "/sdcard/glocon-ui.xml")).stdout;
  const node = [...xml.matchAll(/<node\b[^>]*>/g)]
    .map((match) => match[0])
    .find(
      (value) =>
        value.includes(`content-desc="${label}"`) ||
        value.includes(`text="${label}"`),
    );
  assert.ok(node, `Native control not found: ${label}\n${xml}`);
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(bounds);
  await adb(
    "shell",
    "input",
    "tap",
    String(Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2)),
    String(Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2)),
  );
}
try {
  console.log("Preparing a fresh Expo 57 consumer of the packed library.");
  await cp(join(root, "fixtures/native"), app, { recursive: true });
  const archive = process.argv[2]
    ? resolve(process.argv[2])
    : join(
        temp,
        JSON.parse(
          (
            await exec(
              "npm",
              [
                "pack",
                "--ignore-scripts",
                "--json",
                "--pack-destination",
                temp,
              ],
              { cwd: root },
            )
          ).stdout,
        )[0].filename,
      );
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({
      name: "glocon-native-fixture",
      version: "1.0.0",
      private: true,
      main: "index.js",
      dependencies: {
        expo: "57.0.27",
        react: "19.2.3",
        "react-native": "0.86.3",
      },
    }),
  );
  await writeFile(
    join(app, "app.json"),
    JSON.stringify({
      expo: {
        name: "Glocon native verification",
        slug: "glocon-native-verification",
        version: "1.0.0",
        jsEngine: "hermes",
      },
    }),
  );
  await exec(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    { cwd: app, timeout: 180000, maxBuffer: 4e6 },
  );
  console.log("Waiting for the selected Android emulator to finish booting.");
  await until(
    async () => {
      try {
        return (
          (
            await adb("shell", "getprop", "sys.boot_completed")
          ).stdout.trim() === "1"
        );
      } catch {
        return false;
      }
    },
    "Android boot",
    360000,
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const reportPort = server.address().port;
  // Reserve another loopback port for Metro, then transfer ownership to its process.
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const metroPort = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  await writeFile(
    join(app, "environment.js"),
    `export const reportURL = ${JSON.stringify(`http://127.0.0.1:${reportPort}/`)};\n`,
  );
  await adb("install", "-r", apk);
  await adb("reverse", `tcp:${reportPort}`, `tcp:${reportPort}`);
  reverses.push(reportPort);
  await adb("reverse", `tcp:${metroPort}`, `tcp:${metroPort}`);
  reverses.push(metroPort);
  await adb("shell", "cmd", "uimode", "night", "no");
  metro = spawn(
    process.execPath,
    [
      join(app, "node_modules/expo/bin/cli"),
      "start",
      "--localhost",
      "--port",
      String(metroPort),
    ],
    {
      cwd: app,
      env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [metro.stdout, metro.stderr])
    stream.on("data", (chunk) => {
      metroOutput = (metroOutput + chunk).slice(-200000);
    });
  await until(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${metroPort}/status`)).ok;
      } catch {
        return false;
      }
    },
    "Metro startup",
    90000,
  );
  await adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `exp://127.0.0.1:${metroPort}`,
    "host.exp.exponent",
  );
  console.log("Opening the fixture in the on-device Hermes runtime.");
  const startup = (
    await until(
      () => events.find((event) => event.kind === "startup"),
      "Hermes application startup",
      180000,
    )
  ).value;
  assert.equal(startup.hermes, true);
  assert.deepEqual(
    {
      engine: startup.engine,
      gross: startup.gross,
      formatted: startup.formatted,
      roundtrip: startup.roundtrip,
      time: startup.time,
    },
    {
      engine: "glocon-order-2",
      gross: "17",
      formatted: "$9,007,199,254,740,993.01",
      roundtrip: "999999999999999999999999999999.99",
      time: "2026-11-01T06:30:00Z",
    },
  );
  const healthy = (
    await until(
      () =>
        events.find(
          (event) =>
            event.kind === "layout" &&
            event.value.nodes.length === 3 &&
            event.value.nodes.every((node) => node.frame.width > 0),
        ),
      "Measured native layout",
    )
  ).value;
  assert.deepEqual(healthy.report.findings, [], JSON.stringify(healthy));
  await tap("Record invoice");
  assert.equal(
    (
      await until(
        () => events.find((event) => event.kind === "invoice"),
        "Native invoice interaction",
      )
    ).value.gross,
    "17",
  );
  for (let count = 1; count <= 3; count++) {
    await tap("Credit portion");
    const credit = (
      await until(
        () =>
          events.find(
            (event) => event.kind === "credit" && event.value.count === count,
          ),
        "Native fractional credit interaction",
      )
    ).value;
    assert.equal(credit.gross, ["5", "6", "6"][count - 1]);
  }
  await tap("Credit portion");
  assert.ok(
    (
      await until(
        () => events.find((event) => event.kind === "action-error"),
        "Native over-credit rejection",
      )
    ).value.includes("remaining"),
  );
  await adb("shell", "cmd", "uimode", "night", "yes");
  const dark = (
    await until(
      () =>
        events.find(
          (event) => event.kind === "layout" && event.value.theme === "dark",
        ),
      "Native dark appearance",
    )
  ).value;
  assert.deepEqual(dark.report.findings, [], JSON.stringify(dark));
  await tap("Show defect");
  const broken = (
    await until(
      () =>
        events.find(
          (event) =>
            event.kind === "layout" &&
            event.value.nodes.some(
              (node) => node.testID === "broken" && node.frame.width === 8,
            ),
        ),
      "Measured native defect",
    )
  ).value;
  assert.ok(
    broken.report.findings.some(
      (finding) => finding.ruleId === "interaction/target-size",
    ),
  );
  assert.ok(
    broken.report.findings.some(
      (finding) => finding.ruleId === "native/control-name",
    ),
  );
  const result = {
    android: (
      await adb("shell", "getprop", "ro.build.version.release")
    ).stdout.trim(),
    expo: "57.0.27",
    expoGo: "57.0.9",
    reactNative: startup.reactNative,
    hermes: startup.properties,
    nativeMeasuredLayout: true,
    nativeInteractions: true,
    darkAppearance: true,
    financialGross: "17",
    fractionalCredits: ["5", "6", "6"],
    overCreditRejected: true,
    deliberateDefectsDetected: true,
    scope:
      "One Android Expo Go emulator fixture; no iOS, standalone production APK, screen-reader, keyboard or font-scaling certification.",
  };
  await writeFile(
    "/tmp/glocon-native-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  console.error(metroOutput.slice(-12000));
  process.exitCode = 1;
} finally {
  if (metro?.pid) {
    try {
      process.kill(-metro.pid, "SIGTERM");
    } catch {}
    if (metro.exitCode === null && metro.signalCode === null) {
      await Promise.race([
        new Promise((resolve) => metro.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (metro.exitCode === null && metro.signalCode === null) {
        try {
          process.kill(-metro.pid, "SIGKILL");
        } catch {}
      }
    }
  }
  for (const port of reverses)
    await adb("reverse", "--remove", `tcp:${port}`).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    "/tmp/glocon-native-validation-events.json",
    JSON.stringify(events, null, 2),
  );
  await writeFile("/tmp/glocon-native-metro.log", metroOutput);
  await writeFile(join(temp, "events.json"), JSON.stringify(events, null, 2));
  if (process.env.GLOCON_KEEP_NATIVE === "1")
    console.log(`Retained native fixture: ${temp}`);
  else await rm(temp, { recursive: true, force: true });
}
