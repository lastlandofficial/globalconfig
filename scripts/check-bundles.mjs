import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
const entries = [
  {
    name: "currency formatter",
    path: "currency",
    symbol: "formatCurrency",
    // The verified legacy-Intl exact-digit path adds ~1.6 KB; gzip retains its original 15 KB budget.
    maxBytes: 37000,
    maxGzip: 15000,
  },
  {
    name: "time utilities",
    path: "time",
    symbol: "convertLocalTime",
    maxBytes: 205000,
    maxGzip: 64000,
  },
  {
    name: "global client",
    path: "index",
    symbol: "createGlobalConfig",
    maxBytes: 250000,
    maxGzip: 82000,
  },
  {
    name: "UI core",
    path: "ui/index",
    symbol: "auditSnapshot",
    maxBytes: 12000,
    maxGzip: 5000,
  },
  {
    name: "financial core",
    path: "compliance/index",
    symbol: "calculateOrder",
    maxBytes: 60000,
    maxGzip: 24000,
  },
];
const results = [];
for (const entry of entries) {
  const result = await build({
    stdin: {
      contents: `import {${entry.symbol}} from './dist/${entry.path}.js'; globalThis.gloconBundleProbe=${entry.symbol};`,
      resolveDir: process.cwd(),
      sourcefile: "bundle-probe.js",
    },
    bundle: true,
    minify: true,
    treeShaking: true,
    platform: "browser",
    format: "esm",
    write: false,
  });
  const bytes = result.outputFiles[0].contents;
  const measured = {
    name: entry.name,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    maxBytes: entry.maxBytes,
    maxGzip: entry.maxGzip,
  };
  results.push(measured);
  if (measured.bytes > entry.maxBytes || measured.gzipBytes > entry.maxGzip)
    throw Error(
      `${entry.name} exceeded its reviewed browser bundle budget: ${JSON.stringify(measured)}`,
    );
}
console.log(JSON.stringify(results, null, 2));
if (process.argv[2])
  await writeFile(process.argv[2], JSON.stringify(results, null, 2) + "\n");
