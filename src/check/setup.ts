import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { hash } from "./report";
import {
  configName,
  record,
  validateCheckConfig,
  type CheckConfig,
} from "./config";
import { expectedDestination } from "./destination";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export interface SetupOptions {
  dir: string;
  version: string;
  url?: string;
  command?: string;
  pages?: string;
  manager?: string;
  noInstall?: boolean;
  noCI?: boolean;
  noScreenshots?: boolean;
  ciArtifacts?: boolean;
  ciScreenshots?: boolean;
  artifactRetentionDays?: number;
}
export function detectManager(
  dir: string,
  pkg: Record<string, unknown>,
  override?: string,
): PackageManager {
  const manager =
    override ??
    (typeof pkg.packageManager === "string"
      ? pkg.packageManager.split("@")[0]
      : undefined);
  if (manager) {
    if (!["npm", "pnpm", "yarn", "bun"].includes(manager))
      throw new Error("Package manager must be npm, pnpm, yarn, or bun.");
    return manager as PackageManager;
  }
  const found = (["npm", "pnpm", "yarn", "bun"] as const).filter((name) =>
    ({
      npm: ["package-lock.json", "npm-shrinkwrap.json"],
      pnpm: ["pnpm-lock.yaml"],
      yarn: ["yarn.lock"],
      bun: ["bun.lock", "bun.lockb"],
    })[name].some((file) => existsSync(join(dir, file))),
  );
  if (found.length > 1)
    throw new Error(
      "Multiple lockfiles found. Pass --package-manager npm, pnpm, yarn, or bun.",
    );
  return found[0] ?? "npm";
}
function staticRoutes(dir: string): string[] {
  const found = new Set<string>();
  for (const rootName of ["app", "src/app", "pages", "src/pages"]) {
    const root = join(dir, rootName);
    if (!existsSync(root)) continue;
    const app = rootName.endsWith("app");
    const walk = (current: string, parts: string[]) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (
          entry.name.startsWith("_") ||
          entry.name.startsWith("@") ||
          entry.name.includes("[") ||
          (!app && entry.name === "api")
        )
          continue;
        if (entry.isDirectory()) {
          if (
            entry.name.startsWith("(") &&
            !/^\([^.)][^)]*\)$/.test(entry.name)
          )
            continue;
          walk(
            join(current, entry.name),
            app && entry.name.startsWith("(") ? parts : [...parts, entry.name],
          );
        } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
          const name = entry.name.replace(/\.(tsx?|jsx?)$/, "");
          if (app && name !== "page") continue;
          found.add(
            "/" +
              [...parts, ...(!app && name !== "index" ? [name] : [])].join("/"),
          );
        }
      }
    };
    walk(root, []);
  }
  return [...found].sort().slice(0, 100);
}
export function resolvePlaywright(dir: string): typeof import("playwright") {
  const require = createRequire(join(dir, "package.json"));
  for (const dependency of ["playwright", "@playwright/test"]) {
    try {
      return require(dependency) as typeof import("playwright");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND")
        throw error;
    }
  }
  throw new Error(
    "Playwright is missing from this app. Run glocon init --ui to install it, or add playwright with your package manager.",
  );
}
function browserCLI(dir: string): string {
  const require = createRequire(join(dir, "package.json"));
  for (const module of ["playwright", "@playwright/test"]) {
    try {
      const manifest = require.resolve(`${module}/package.json`);
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.playwright;
      if (typeof bin === "string") return resolve(dirname(manifest), bin);
    } catch {}
  }
  throw new Error(
    "Cannot find the local Playwright CLI. Install playwright in this app.",
  );
}
function writeIfMissing(file: string, content: string) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { flag: "wx" });
  }
}
function addIgnores(dir: string) {
  const file = join(dir, ".gitignore");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const additions = ["/.glocon/"].filter(
    (line) => !current.split(/\r?\n/).includes(line),
  );
  if (additions.length)
    writeFileSync(
      file,
      current +
        (current && !current.endsWith("\n") ? "\n" : "") +
        additions.join("\n") +
        "\n",
    );
}
function workflow(
  manager: PackageManager,
  pkg: Record<string, unknown>,
  dir: string,
  options: SetupOptions,
): string {
  const packageManager =
    typeof pkg.packageManager === "string" ? pkg.packageManager : "";
  const version = packageManager.startsWith(`${manager}@`)
    ? packageManager.slice(manager.length + 1).split("+")[0]!
    : { npm: "", pnpm: "10", yarn: "1.22.22", bun: "1" }[manager];
  if (version && !/^[\d.]+$/.test(version))
    throw new Error(
      "CI generation needs an exact numeric packageManager version; use --no-ci and configure CI manually.",
    );
  const locked = {
    npm: ["package-lock.json", "npm-shrinkwrap.json"],
    pnpm: ["pnpm-lock.yaml"],
    yarn: ["yarn.lock"],
    bun: ["bun.lock", "bun.lockb"],
  }[manager].some((file) => existsSync(join(dir, file)));
  const install =
    manager === "npm"
      ? locked
        ? "npm ci"
        : "npm install"
      : manager === "yarn"
        ? `yarn install${locked ? (Number(version.split(".")[0]) >= 2 ? " --immutable" : " --frozen-lockfile") : ""}`
        : `${manager} install${locked ? " --frozen-lockfile" : ""}`;
  const invoke =
    manager === "npm"
      ? "npx --no-install"
      : manager === "pnpm"
        ? "pnpm exec"
        : manager === "bun"
          ? "bun run"
          : "yarn";
  const setup =
    manager === "pnpm"
      ? `      - uses: pnpm/action-setup@v4\n        with:\n          version: ${JSON.stringify(version)}\n`
      : manager === "bun"
        ? `      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: ${JSON.stringify(version)}\n`
        : manager === "yarn"
          ? `      - run: npm install --global corepack && corepack enable && corepack prepare yarn@${version} --activate\n`
          : "";
  const artifacts = options.ciArtifacts
    ? `      # Reports can contain application selectors and measured content; upload is explicitly enabled.\n      - uses: actions/upload-artifact@v4\n        if: always()\n        with:\n          name: glocon-ui-report\n          retention-days: ${options.artifactRetentionDays ?? 7}\n          if-no-files-found: ignore\n          path: |\n            .glocon/report.html\n            .glocon/report.json\n${options.ciScreenshots ? "            .glocon/screenshots/*.png\n" : ""}`
    : "";
  const content = `# Generated by glocon. Edited files are preserved on subsequent setup runs.\nname: glocon UI checks\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  ui:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n${setup}      - run: ${install}\n      - run: ${invoke} playwright install --with-deps chromium\n      - run: ${invoke} glocon check\n${artifacts}`;
  return `# glocon-managed-sha256: ${hash(content)}\n${content}`;
}
function untouchedWorkflow(content: string): boolean {
  const newline = content.indexOf("\n");
  return (
    newline >= 0 &&
    content.slice(0, newline) ===
      `# glocon-managed-sha256: ${hash(content.slice(newline + 1))}`
  );
}
export async function setupProject(options: SetupOptions) {
  const dir = resolve(options.dir);
  if (options.ciScreenshots && !options.ciArtifacts)
    throw new Error(
      "--ci-screenshots requires --ci-artifacts to explicitly enable report uploads.",
    );
  if (
    options.artifactRetentionDays !== undefined &&
    (!options.ciArtifacts ||
      !Number.isInteger(options.artifactRetentionDays) ||
      options.artifactRetentionDays < 1 ||
      options.artifactRetentionDays > 90)
  )
    throw new Error(
      "--artifact-retention-days requires --ci-artifacts and an integer from 1 to 90.",
    );
  if (options.noCI && (options.ciArtifacts || options.ciScreenshots))
    throw new Error("CI artifact options cannot be combined with --no-ci.");
  if (options.noScreenshots && options.ciScreenshots)
    throw new Error(
      "--ci-screenshots cannot be combined with --no-screenshots.",
    );
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath))
    throw new Error(
      "Run glocon init --ui in an existing application containing package.json.",
    );
  const pkg: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!record(pkg)) throw new Error("package.json must be an object.");
  if (pkg.name === "glocon")
    throw new Error(
      "Run setup in an application, not the glocon package itself.",
    );
  for (const key of ["scripts", "dependencies", "devDependencies"])
    if (pkg[key] !== undefined && !record(pkg[key]))
      throw new Error(`package.json ${key} must be an object.`);
  const manager = detectManager(dir, pkg, options.manager);
  const deps = {
    ...(pkg.dependencies as Record<string, string>),
    ...(pkg.devDependencies as Record<string, string>),
  };
  const framework = deps.next
    ? "Next.js"
    : deps.vite
      ? "Vite"
      : "Generic web app";
  const scripts = { ...(pkg.scripts as Record<string, string>) };
  const existingPlaywright = ["ts", "mts", "cts", "js", "mjs", "cjs"]
    .map((ext) => `playwright.config.${ext}`)
    .find((file) => existsSync(join(dir, file)));
  const configFile = join(dir, configName);
  let config: CheckConfig;
  if (existsSync(configFile)) {
    config = validateCheckConfig(JSON.parse(readFileSync(configFile, "utf8")));
    if (options.noScreenshots && config.screenshots !== false)
      throw new Error(
        `Existing ${configName} is preserved. Set screenshots to false in that file before using --no-screenshots.`,
      );
    if (options.ciScreenshots && config.screenshots === false)
      throw new Error(
        `Screenshot capture is disabled in ${configName}. Enable it before using --ci-screenshots.`,
      );
    if (options.url || options.command || options.pages)
      throw new Error(
        `Existing ${configName} is preserved. Edit its baseURL, webServer, or pages directly.`,
      );
  } else {
    const selected = scripts.dev ? "dev" : scripts.start ? "start" : undefined;
    let command =
      options.command ?? (selected ? `${manager} run ${selected}` : undefined);
    let url = options.url;
    const script = selected ? scripts[selected] : "";
    const port = /(?:--port(?:=|\s+)|-p\s+)(\d+)/.exec(script ?? "")?.[1];
    if (!url && framework !== "Generic web app")
      url = `http://localhost:${port ?? (framework === "Next.js" ? 3000 : 5173)}`;
    if (!url) {
      if (!process.stdin.isTTY)
        throw new Error(
          'Could not determine the app URL. Pass --url http://localhost:3000 and optionally --command "npm run dev".',
        );
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        url = (
          await prompt.question("App URL (for example http://localhost:3000): ")
        ).trim();
      } finally {
        prompt.close();
      }
    }
    const discovered = framework === "Next.js" ? staticRoutes(dir) : [];
    let audit: CheckConfig["audit"];
    let failOn: CheckConfig["failOn"];
    let pages: CheckConfig["pages"] = options.pages
      ? options.pages.split(",").map((p) => p.trim())
      : discovered.length
        ? discovered
        : ["/"];
    if (existsSync(join(dir, "glocon.ui.json"))) {
      const previous = JSON.parse(
        readFileSync(join(dir, "glocon.ui.json"), "utf8"),
      );
      if (!record(previous))
        throw new Error("glocon.ui.json must be an object.");
      const {
        viewport: _viewport,
        failOn: previousFailOn,
        expectedURL: previousExpectedURL,
        ...previousAudit
      } = previous;
      audit = previousAudit;
      failOn = previousFailOn as CheckConfig["failOn"];
      if (previousExpectedURL !== undefined) {
        if (typeof previousExpectedURL !== "string")
          throw new Error(
            "glocon.ui.json expectedURL must be a same-origin HTTP(S) URL.",
          );
        let destination: URL;
        try {
          destination = expectedDestination(previousExpectedURL, url);
        } catch {
          throw new Error(
            "glocon.ui.json expectedURL must stay on --url's origin. Select the reviewed destination with --url/--pages, or continue using glocon audit.",
          );
        }
        const expectedURL =
          destination.pathname + destination.search + destination.hash;
        if (options.pages && pages.length !== 1)
          throw new Error(
            "glocon.ui.json expectedURL describes one destination. Use one --pages path during migration, then add other pages to glocon.check.json.",
          );
        pages = [
          {
            path: options.pages
              ? String(pages[0])
              : destination.pathname + destination.search,
            expectedURL,
          },
        ];
        console.log(
          "Migrated the reviewed standalone expectedURL to one project page. Add other representative pages to glocon.check.json.",
        );
      }
    }
    config = validateCheckConfig({
      $schema: "./node_modules/glocon/docs/ui/check-config.schema.json",
      version: 1,
      baseURL: url,
      pages,
      viewports: [
        { name: "phone", width: 390, height: 844 },
        { name: "desktop", width: 1280, height: 800 },
      ],
      ...(command
        ? { webServer: { command, timeout: 60000, reuseExistingServer: true } }
        : {}),
      failOn: failOn ?? "error",
      screenshots: !options.noScreenshots,
      ...(audit ? { audit } : {}),
    });
  }
  const updated: Record<string, unknown> = {
    ...pkg,
    scripts: { "glocon:check": "glocon check", ...scripts },
    devDependencies: {
      ...(pkg.devDependencies as Record<string, string>),
      ...(!deps.glocon ? { glocon: `^${options.version}` } : {}),
      ...(!deps.playwright && !deps["@playwright/test"]
        ? { playwright: "^1.58.2" }
        : {}),
      ...(!deps["@axe-core/playwright"]
        ? { "@axe-core/playwright": "^4.10.2" }
        : {}),
    },
  };
  // Validate the template before modifying project files.
  if (!options.noCI) workflow(manager, pkg, dir, options);
  addIgnores(dir);
  writeIfMissing(configFile, JSON.stringify(config, null, 2) + "\n");
  writeFileSync(manifestPath, JSON.stringify(updated, null, 2) + "\n");
  console.log(
    `Configured ${framework} with ${manager}. Review ${configName}: ${config.pages.length} page(s), ${config.viewports.length} screen sizes.`,
  );
  if (existingPlaywright)
    console.log(
      `Preserved ${existingPlaywright}. Reuse its test login via auth.storageState and auth.setupCommand in ${configName}.`,
    );
  let installError: unknown;
  if (!options.noInstall) {
    try {
      execFileSync(
        manager,
        manager === "npm"
          ? ["install", "--no-audit", "--no-fund"]
          : ["install"],
        { cwd: dir, stdio: "inherit", shell: process.platform === "win32" },
      );
      execFileSync(process.execPath, [browserCLI(dir), "install", "chromium"], {
        cwd: dir,
        stdio: "inherit",
      });
    } catch (error) {
      installError = error;
    }
  }
  if (!options.noCI) {
    let repositoryRoot = dir;
    try {
      repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}
    if (resolve(repositoryRoot) !== dir)
      console.log(
        "This app is inside a larger repository. Add glocon check to its existing CI with the correct working directory.",
      );
    else {
      const workflowPath = join(dir, ".github/workflows/glocon.yml");
      const content = workflow(manager, pkg, dir, options);
      if (
        !existsSync(workflowPath) ||
        untouchedWorkflow(readFileSync(workflowPath, "utf8"))
      ) {
        mkdirSync(dirname(workflowPath), { recursive: true });
        writeFileSync(workflowPath, content);
      } else console.log(`Preserved edited ${relative(dir, workflowPath)}.`);
    }
  }
  if (installError)
    throw new Error(
      `Setup files were saved, but dependency/browser installation failed: ${installError instanceof Error ? installError.message : String(installError)}. Run glocon init --ui again to retry.`,
    );
  if (options.noInstall)
    console.log(
      `Next: ${manager} install, then your package manager's playwright install chromium command.`,
    );
  console.log(
    "Run glocon check. Reports and test sessions stay in .glocon/ (gitignored); screenshots may contain app content.",
  );
}
