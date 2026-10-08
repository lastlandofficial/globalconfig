import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import {
  checkSources,
  recordSourceBaseline,
  validateSourceBaseline,
} from "../dist/compliance/sources.js";

const exec = promisify(execFile);
const cli = resolve("bin/glocon.mjs");
const original =
  "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm";
const other = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm";
const redirected = "https://www.nta.go.jp/reviewed-document.htm";
const content = "Reviewed official document.";
const digest = createHash("sha256").update(content).digest("hex");
const requirements = (...urls) =>
  urls.map((source, index) => ({
    id: `source-${index}`,
    title: "Official source fixture",
    country: "JP",
    source,
    provision: "Fixture provision",
    reviewedOn: "2026-10-08",
    reviewAfter: "2026-12-08",
    scope: "Source monitoring regression fixture",
  }));
const rich = (effectiveURL = original, value = digest) => ({
  version: 1,
  digest: value,
  effectiveURL,
});
const options = { perHostDelayMs: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("source baselines validate before fetching and retain archived HTTPS entries", async () => {
  for (const malformed of [
    null,
    [],
    "baseline",
    { [original]: "not-a-sha256" },
    { [original]: 1 },
    { "http://www.nta.go.jp/document": digest },
    { "https://name:password@www.nta.go.jp/document": digest },
    { [original]: { ...rich(), version: 2 } },
    { [original]: { ...rich(), digest: "bad" } },
    { [original]: { ...rich(), effectiveURL: "relative.htm" } },
    { [original]: { ...rich(), unexpected: true } },
  ]) {
    let requested = false;
    await assert.rejects(
      checkSources(
        requirements(original),
        malformed,
        async () => {
          requested = true;
          return new Response(content);
        },
        options,
      ),
    );
    assert.equal(requested, false);
  }
  const archived = "https://archived.example/document.htm";
  const baseline = validateSourceBaseline({
    [original]: digest.toUpperCase(),
    [archived]: rich(archived),
  });
  assert.equal(baseline[original], digest);
  assert.deepEqual(baseline[archived], rich(archived));
});

test("source observations deduplicate URLs and keep unsupported URLs unfetched", async () => {
  const requested = [];
  const unsupported = "https://unreviewed.example/document";
  const result = await checkSources(
    requirements(original, original, unsupported),
    { [original]: digest },
    async (url) => {
      requested.push(url);
      return new Response(content);
    },
    options,
  );
  assert.deepEqual(requested, [original]);
  assert.equal(result.length, 2);
  assert.equal(result[0].status, "unchanged");
  assert.equal(result[0].effectiveURL, original);
  assert.deepEqual(result[0].redirectChain, [original]);
  assert.equal(result[1].status, "not-checked");
  assert.equal(result[1].digest, undefined);
});

test("redirected document identity remains reviewable even when bytes match", async () => {
  const fetcher = async (url) =>
    url === original
      ? new Response(null, {
          status: 302,
          headers: { location: redirected },
        })
      : new Response(content, { headers: { "content-type": "text/html" } });
  const [legacy] = await checkSources(
    requirements(original),
    { [original]: digest },
    fetcher,
    options,
  );
  assert.equal(legacy.status, "changed");
  assert.equal(legacy.reviewRequired, true);
  assert.equal(legacy.effectiveURL, redirected);
  assert.deepEqual(legacy.redirectChain, [original, redirected]);
  const [recorded] = await checkSources(
    requirements(original),
    { [original]: rich(redirected) },
    fetcher,
    options,
  );
  assert.equal(recorded.status, "unchanged");
  const [moved] = await checkSources(
    requirements(original),
    { [original]: rich() },
    fetcher,
    options,
  );
  assert.equal(moved.status, "changed");
  assert.equal(moved.reviewRequired, true);
});

test("source requests follow only allowlisted redirect destinations", async () => {
  const requested = [];
  const [result] = await checkSources(
    requirements(original),
    { [original]: rich() },
    async (url) => {
      requested.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: "https://unreviewed.example/document" },
      });
    },
    options,
  );
  assert.deepEqual(requested, [original]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.digest, undefined);
});

test("only complete supported documents receive content digests", async () => {
  const invalid = [
    () => new Response("partial", { status: 206 }),
    () =>
      new Response("partial", {
        headers: { "content-range": "bytes 0-6/10000" },
      }),
    () =>
      new Response("{}", { headers: { "content-type": "application/json" } }),
    () => new Response("pixels", { headers: { "content-type": "image/png" } }),
    () =>
      new Response("bytes", {
        headers: { "content-type": "application/octet-stream" },
      }),
    () => new Response(""),
    () => new Response("x".repeat(5 * 1024 * 1024 + 1)),
    () => new Response("maintenance", { status: 503 }),
  ];
  for (const response of invalid) {
    const [result] = await checkSources(
      requirements(original),
      { [original]: rich() },
      async () => response(),
      options,
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.digest, undefined);
    assert.deepEqual(recordSourceBaseline({ [original]: rich() }, [result]), {
      [original]: rich(),
    });
  }
  for (const type of [
    "text/plain",
    "text/html; charset=utf-8",
    "application/pdf",
  ]) {
    const [result] = await checkSources(
      requirements(original),
      { [original]: digest },
      async () => new Response(content, { headers: { "content-type": type } }),
      options,
    );
    assert.equal(result.status, "unchanged", type);
    assert.equal(result.digest, digest, type);
  }
});

test("recording upgrades successful observations while preserving failed and archived records", async () => {
  const archived = "https://archived.example/document";
  const baseline = {
    [original]: digest,
    [other]: rich(other),
    [archived]: digest,
  };
  const saved = structuredClone(baseline);
  const observations = await checkSources(
    requirements(original, other),
    baseline,
    async (url) =>
      url === original
        ? new Response(content)
        : new Response("unavailable", { status: 503 }),
    options,
  );
  const recorded = recordSourceBaseline(baseline, observations);
  assert.deepEqual(recorded[original], rich());
  assert.deepEqual(recorded[other], rich(other));
  assert.equal(recorded[archived], digest);
  assert.deepEqual(
    baseline,
    saved,
    "recording must not mutate the caller's baseline",
  );
});

test("source concurrency is bounded by both global and per-host limits, with stable output order", async () => {
  const urls = [
    original,
    other,
    "https://cdtfa.ca.gov/document-a.htm",
    "https://cdtfa.ca.gov/document-b.htm",
  ];
  let active = 0;
  let maximum = 0;
  const activeHosts = new Map();
  const results = await checkSources(
    requirements(...urls),
    {},
    async (url) => {
      const host = new URL(url).hostname;
      active++;
      maximum = Math.max(maximum, active);
      activeHosts.set(host, (activeHosts.get(host) ?? 0) + 1);
      assert.ok(active <= 2);
      assert.equal(activeHosts.get(host), 1);
      await sleep(url === original ? 30 : 5);
      active--;
      activeHosts.set(host, activeHosts.get(host) - 1);
      return new Response(content);
    },
    { concurrency: 2, perHostConcurrency: 1, perHostDelayMs: 0 },
  );
  assert.equal(maximum, 2, "independent hosts should be fetched concurrently");
  assert.deepEqual(
    results.map((result) => result.url),
    urls,
  );
  assert.ok(results.every((result) => result.digest === digest));
});

for (const perHostConcurrency of [1, 3]) {
  test(
    `source request starts stay paced after an event-loop stall with per-host concurrency ${perHostConcurrency}`,
    { timeout: 2000 },
    async () => {
      const started = [];
      let stalled = false;
      let stallTimer;
      try {
        const results = await checkSources(
          requirements(original, other, redirected),
          {},
          async () => {
            started.push(performance.now());
            if (started.length === 1)
              stallTimer = setTimeout(() => {
                stalled = true;
                // Stall through two scheduled start times. Their callbacks must
                // retain pacing instead of issuing a burst when the loop resumes.
                Atomics.wait(
                  new Int32Array(new SharedArrayBuffer(4)),
                  0,
                  0,
                  60,
                );
              }, 5);
            return new Response(content);
          },
          {
            concurrency: 3,
            perHostConcurrency,
            perHostDelayMs: 25,
            timeoutMs: 1000,
          },
        );
        assert.equal(stalled, true);
        assert.equal(started.length, 3);
        assert.ok(results.every((entry) => entry.digest === digest));
        for (let index = 1; index < started.length; index++) {
          const gap = started[index] - started[index - 1];
          assert.ok(
            gap >= 23,
            `Actual request starts were only ${gap.toFixed(2)} ms apart.`,
          );
        }
      } finally {
        clearTimeout(stallTimer);
      }
    },
  );
}

test(
  "source request deadlines terminate fetchers that ignore cancellation",
  { timeout: 1500 },
  async () => {
    const [result] = await checkSources(
      requirements(original),
      { [original]: rich() },
      async () => new Promise(() => {}),
      { ...options, requestTimeoutMs: 25, timeoutMs: 100 },
    );
    assert.equal(result.status, "unavailable");
    assert.match(result.message, /timeout|timed out|deadline|abort/i);
    assert.equal(result.digest, undefined);
  },
);

test(
  "the overall source deadline includes queued tasks without starting more requests",
  { timeout: 1500 },
  async () => {
    const requested = [];
    const result = await checkSources(
      requirements(original, other, redirected),
      {},
      async (url) => {
        requested.push(url);
        return new Promise(() => {});
      },
      {
        concurrency: 1,
        perHostDelayMs: 0,
        requestTimeoutMs: 500,
        timeoutMs: 30,
      },
    );
    assert.deepEqual(requested, [original]);
    assert.deepEqual(
      result.map((entry) => entry.url),
      [original, other, redirected],
    );
    assert.ok(result.every((entry) => entry.status === "unavailable"));
    assert.ok(
      result.every((entry) =>
        /deadline|timeout|timed out/i.test(entry.message),
      ),
    );
  },
);

test(
  "queued sources receive their complete request deadline after a slot becomes available",
  { timeout: 2000 },
  async () => {
    const urls = [
      original,
      other,
      redirected,
      "https://www.nta.go.jp/fourth.htm",
    ];
    const requested = [];
    const result = await checkSources(
      requirements(...urls),
      {},
      async (url) => {
        requested.push(url);
        await sleep(40);
        return new Response(content);
      },
      {
        concurrency: 1,
        perHostDelayMs: 0,
        requestTimeoutMs: 100,
        timeoutMs: 1000,
      },
    );
    assert.deepEqual(requested, urls);
    assert.ok(result.every((entry) => entry.digest === digest));
  },
);

test(
  "an external abort cancels in-flight and queued source work without future fetches",
  { timeout: 1500 },
  async () => {
    const controller = new AbortController();
    const requested = [];
    let announceRequest;
    const started = new Promise((resolve) => {
      announceRequest = resolve;
    });
    const pending = checkSources(
      requirements(original, other, redirected),
      {},
      async (url, init) => {
        requested.push(url);
        assert.ok(init.signal instanceof AbortSignal);
        announceRequest();
        return new Promise(() => {});
      },
      { concurrency: 1, perHostDelayMs: 0, signal: controller.signal },
    );
    await started;
    controller.abort(new Error("Cancelled source review fixture."));
    const result = await pending;
    assert.ok(result.every((entry) => entry.status === "unavailable"));
    assert.ok(
      result.every((entry) =>
        /Cancelled source review fixture/.test(entry.message),
      ),
    );
    await sleep(20);
    assert.deepEqual(requested, [original]);
  },
);

test(
  "a stalled body reader is cancelled when its source deadline expires",
  { timeout: 1500 },
  async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("incomplete document"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const [result] = await checkSources(
      requirements(original),
      { [original]: rich() },
      async () =>
        new Response(body, { headers: { "content-type": "text/html" } }),
      { ...options, requestTimeoutMs: 30, timeoutMs: 500 },
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.digest, undefined);
    assert.equal(cancelled, true);
    assert.match(result.message, /deadline|timeout|timed out/i);
  },
);

test("invalid and mismatched Content-Length values cannot establish a baseline", async () => {
  const size = Buffer.byteLength(content);
  for (const length of [
    String(size + 1),
    "-1",
    "1.5",
    "NaN",
    "9007199254740993",
  ]) {
    const [result] = await checkSources(
      requirements(original),
      { [original]: rich() },
      async () =>
        new Response(content, {
          headers: { "content-length": length },
        }),
      options,
    );
    assert.equal(result.status, "unavailable", length);
    assert.equal(result.digest, undefined, length);
    assert.match(result.message, /Content-Length/i, length);
  }
  const [complete] = await checkSources(
    requirements(original),
    { [original]: rich() },
    async () =>
      new Response(content, { headers: { "content-length": String(size) } }),
    options,
  );
  assert.equal(complete.status, "unchanged");
  assert.equal(complete.digest, digest);
});

async function runCLI(dir, args, mock) {
  try {
    const nodeArgs = mock ? ["--import", pathToFileURL(mock).href] : [];
    return {
      ...(await exec(
        process.execPath,
        [...nodeArgs, cli, ...args, "--dir", dir],
        {
          timeout: 10000,
          env: { ...process.env, GLOCON_SOURCE_TEST_DIR: dir },
        },
      )),
      code: 0,
    };
  } catch (error) {
    return error;
  }
}

async function withCLI(callback) {
  const dir = await mkdtemp(join(tmpdir(), "glocon-source-monitor-"));
  const mock = join(dir, "mock-fetch.mjs");
  try {
    const initialized = await runCLI(dir, [
      "compliance",
      "init",
      "--country",
      "JP",
      "--demo",
    ]);
    assert.equal(initialized.code, 0, initialized.stderr);
    await writeFile(
      mock,
      `
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
const dir = process.env.GLOCON_SOURCE_TEST_DIR;
const fixtures = JSON.parse(await readFile(join(dir, "responses.json"), "utf8"));
globalThis.fetch = async (url) => {
  await appendFile(join(dir, "requests.txt"), String(url) + "\\n");
  const fixture = fixtures[url] ?? { body: ${JSON.stringify(content)}, status: 200 };
  return new Response(fixture.body ?? null, { status: fixture.status ?? 200, headers: fixture.headers });
};
`,
    );
    await writeFile(join(dir, "responses.json"), "{}");
    await callback(dir, mock);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("source CLI rejects malformed baselines before network access or recording", async () => {
  await withCLI(async (dir, mock) => {
    for (const value of [[], { [original]: "bad-digest" }]) {
      const text = JSON.stringify(value);
      await writeFile(join(dir, "glocon.sources.json"), text);
      const result = await runCLI(
        dir,
        ["compliance", "sources", "check", "--record"],
        mock,
      );
      assert.equal(result.code, 2, result.stderr);
      assert.equal(
        await readFile(join(dir, "glocon.sources.json"), "utf8"),
        text,
      );
      await assert.rejects(readFile(join(dir, "requests.txt")), {
        code: "ENOENT",
      });
    }
  });
});

test("source CLI records rich baselines and preserves valid records for failed retrievals", async () => {
  await withCLI(async (dir, mock) => {
    const oldOther = rich(other, "a".repeat(64));
    await writeFile(
      join(dir, "glocon.sources.json"),
      JSON.stringify({
        [original]: digest,
        [other]: oldOther,
      }),
    );
    await writeFile(
      join(dir, "responses.json"),
      JSON.stringify({
        [other]: {
          body: "partial",
          status: 206,
          headers: { "content-range": "bytes 0-6/10000" },
        },
      }),
    );
    const result = await runCLI(
      dir,
      [
        "compliance",
        "sources",
        "check",
        "--record",
        "--concurrency",
        "2",
        "--per-host-delay",
        "0",
        "--timeout",
        "1000",
      ],
      mock,
    );
    assert.equal(result.code, 2, result.stderr);
    const observations = JSON.parse(result.stdout);
    assert.equal(
      observations.find((entry) => entry.url === original).status,
      "unchanged",
    );
    assert.equal(
      observations.find((entry) => entry.url === other).status,
      "unavailable",
    );
    const recorded = JSON.parse(
      await readFile(join(dir, "glocon.sources.json"), "utf8"),
    );
    assert.deepEqual(recorded[original], rich());
    assert.deepEqual(recorded[other], oldOther);
  });
});
