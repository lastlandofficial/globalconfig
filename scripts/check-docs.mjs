import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(join(root, file), "utf8");
const manifest = JSON.parse(await read("package.json"));
// git's file inventory excludes generated reports, installed dependencies and build output.
const inventory = (
  await exec(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  )
).stdout
  .split("\0")
  .filter(Boolean);
const markdown = [...new Set(inventory.filter((file) => file.endsWith(".md")))];
const contents = new Map(
  await Promise.all(
    markdown.map(async (file) => [resolve(root, file), await read(file)]),
  ),
);
const failures = [];
let links = 0;

function prose(text) {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
}

function anchors(text) {
  const result = new Set();
  const occurrences = new Map();
  for (const match of prose(text).matchAll(
    /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm,
  )) {
    const slug = match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
      .replace(/ /g, "-");
    const previous = occurrences.get(slug) ?? 0;
    occurrences.set(slug, previous + 1);
    result.add(previous ? `${slug}-${previous}` : slug);
  }
  for (const match of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g))
    result.add(match[1]);
  return result;
}

for (const file of markdown) {
  const text = prose(contents.get(resolve(root, file)));
  const destinations = [
    ...[
      ...text.matchAll(
        /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
      ),
    ].map((match) => match[1] ?? match[2]),
    ...[...text.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)].map(
      (match) => match[1] ?? match[2],
    ),
  ];
  for (const destination of destinations) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue;
    links++;
    try {
      const [location, fragment] = destination.split("#", 2);
      const pathname = decodeURIComponent(location.split("?", 1)[0]);
      const target = pathname
        ? resolve(dirname(join(root, file)), pathname)
        : resolve(root, file);
      await access(target);
      if (fragment && extname(target) === ".md") {
        const targetText =
          contents.get(target) ?? (await readFile(target, "utf8"));
        assert.ok(
          anchors(targetText).has(decodeURIComponent(fragment)),
          `missing heading #${fragment}`,
        );
      }
    } catch (error) {
      failures.push(`${file}: ${destination}: ${error.message}`);
    }
  }
}
assert.equal(
  failures.length,
  0,
  `Broken local documentation links:\n${failures.join("\n")}`,
);

const [readme, uiGuide, agentGuide, financialGuide, ui, financial] =
  await Promise.all([
    read("README.md"),
    read("docs/ui/README.md"),
    read("llms.txt"),
    read("docs/compliance/README.md"),
    import(new URL("../dist/ui/index.js", import.meta.url)),
    import(new URL("../dist/compliance/index.js", import.meta.url)),
  ]);
// check:docs follows the build in npm run check. Inspect executable contracts so
// ordinary source formatting or internal calculation arguments cannot break it.
const report = ui.createReport("documentation-contract", [], {
  rules: [],
  elements: 0,
  limitations: [],
});
const { schemaVersion, engineVersion } = report;
const example = financial.createComplianceExample("JP");
const quote = financial.calculateOrder(example.config, example.order);
assert.equal(
  quote.status,
  "ready",
  "Built financial example must calculate successfully",
);
const financialEngine = quote.value.engine;
assert.ok(
  agentGuide.startsWith(
    `# ${manifest.name} ${manifest.version} release candidate\n`,
  ),
  "llms.txt package version differs from package.json",
);
assert.ok(
  readme.includes(`**${manifest.version} release candidate**`) &&
    readme.includes(`${manifest.name}-${manifest.version}.tgz`),
  "README candidate/install version differs from package.json",
);
assert.ok(
  agentGuide.includes(
    `schemaVersion is ${schemaVersion}. engineVersion is ${engineVersion}`,
  ),
  "Agent guide report versions differ from the UI engine",
);
for (const [file, text] of [
  ["llms.txt", agentGuide],
  ["docs/compliance/README.md", financialGuide],
])
  assert.ok(
    text.includes(financialEngine),
    `${file} omits the current financial engine ${financialEngine}`,
  );
for (const [file, text] of [
  ["llms.txt", agentGuide],
  ["docs/ui/README.md", uiGuide],
])
  for (const token of ["outcomes", "passed", "failed", "manual-review"])
    assert.ok(text.includes(token), `${file} omits report outcome ${token}`);
for (const [file, text] of [
  ["llms.txt", agentGuide],
  ["docs/compliance/README.md", financialGuide],
])
  for (const token of [
    "previousDigest",
    "historyLength",
    "appliesFrom",
    "reviewAppliesFrom",
  ])
    assert.ok(
      text.includes(token),
      `${file} omits financial contract ${token}`,
    );
for (const [file, text] of [
  ["README.md", readme],
  ["docs/ui/README.md", uiGuide],
]) {
  assert.match(
    text,
    /npm install -D[^\n]*\bplaywright\b[^\n]*@axe-core\/playwright/,
    `${file} must install both standalone audit peers`,
  );
  assert.match(
    text,
    /npx --no-install playwright install chromium/,
    `${file} must document Chromium installation`,
  );
  assert.match(
    text,
    /npx --no-install glocon audit /,
    `${file} must use the locally installed audit CLI`,
  );
}
const standalone = agentGuide
  .split("## Standalone workflow")[1]
  ?.split("\n## ")[0];
assert.ok(
  standalone?.includes("playwright") &&
    standalone.includes("@axe-core/playwright") &&
    /chromium/i.test(standalone),
  "Agent standalone workflow must mention both browser peers and Chromium",
);
for (const peer of ["playwright", "@axe-core/playwright"])
  assert.equal(
    manifest.peerDependenciesMeta[peer]?.optional,
    true,
    `${peer} must remain optional for utility consumers`,
  );

const schemaFiles = [
  ...new Set([
    ...inventory.filter((file) => file.endsWith(".schema.json")),
    ...Object.values(manifest.exports)
      .filter(
        (target) =>
          typeof target === "string" && target.endsWith(".schema.json"),
      )
      .map((target) => target.replace(/^\.\//, "")),
  ]),
];
const schemas = await Promise.all(
  schemaFiles.map(async (file) => ({
    file,
    value: JSON.parse(await read(file)),
  })),
);
const knownIds = new Map(schemas.map((schema) => [schema.value.$id, schema]));
function verifyReferences(value, document) {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string") {
    const [path, fragment] = value.$ref.split("#", 2);
    let target = document;
    if (path) {
      const id = new URL(path, document.value.$id).href;
      target = knownIds.get(id);
      assert.ok(
        target,
        `${document.file}: unresolved schema reference ${value.$ref}`,
      );
      if (!/^[a-z][a-z\d+.-]*:/i.test(path))
        assert.equal(
          resolve(root, target.file),
          resolve(dirname(join(root, document.file)), path),
          `${document.file}: schema ID and relative file disagree`,
        );
    }
    if (fragment?.startsWith("/")) {
      let pointer = target.value;
      for (const part of decodeURIComponent(fragment).slice(1).split("/")) {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        assert.ok(
          pointer && Object.hasOwn(pointer, key),
          `${document.file}: unresolved schema pointer ${value.$ref}`,
        );
        pointer = pointer[key];
      }
    }
  }
  for (const child of Object.values(value)) verifyReferences(child, document);
}
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
for (const schema of schemas) {
  assert.equal(
    schema.value.$schema,
    "https://json-schema.org/draft/2020-12/schema",
    `${schema.file} must declare Draft 2020-12`,
  );
  assert.ok(schema.value.$id, `${schema.file} must declare its canonical ID`);
  verifyReferences(schema.value, schema);
  ajv.addSchema(schema.value);
}
for (const schema of schemas)
  assert.equal(
    typeof ajv.getSchema(schema.value.$id),
    "function",
    `${schema.file} did not compile`,
  );
assert.equal(
  schemas.find(({ file }) => file === "docs/ui/report.schema.json")?.value
    .properties.schemaVersion.const,
  schemaVersion,
);
assert.deepEqual(
  schemas.find(({ file }) => file === "docs/ui/report.schema.json")?.value
    .properties.coverage.properties.outcomes.items.properties.status.enum,
  ["passed", "failed", "manual-review"],
  "Report schema must retain observed pass/failure/manual-review outcomes",
);
console.log(
  `Documentation verified: ${markdown.length} Markdown files, ${links} local links, package/UI/financial contracts, optional-peer setup and ${schemas.length} compiled schemas.`,
);
