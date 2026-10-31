import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let command;
let args;
if (readExecutionProfile() === "managed-linux") {
  command = "bash";
  // Invoking bash explicitly also works in clones that do not retain executable bits.
  args = ["scripts/sites-env.sh", "--", "bash", "scripts/install-pnpm.sh"];
} else {
  command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const version = spawnSync(command, ["--version"], { encoding: "utf8", cwd: root });
  if (version.error || version.status !== 0 || version.stdout.trim() !== "11.25.0") {
    throw new Error("Install pnpm 11.25.0 before running install:ci.");
  }
  args = ["install", "--frozen-lockfile"];
}
const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
