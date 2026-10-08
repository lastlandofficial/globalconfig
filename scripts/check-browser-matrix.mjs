import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test"],
  {
    stdio: "inherit",
    env: { ...process.env, GLOCON_BROWSER_MATRIX: "1" },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
