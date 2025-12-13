import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const isWindows = process.platform === "win32";
const tscBin = resolve(
  process.cwd(),
  "node_modules",
  ".bin",
  isWindows ? "tsc.cmd" : "tsc"
);

function spawnChild(command, args, options) {
  return spawn(command, args, {
    stdio: "inherit",
    ...options
  });
}

async function runOnce(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawnChild(command, args, {});
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(undefined);
      else rejectPromise(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  const passthroughArgs = process.argv.slice(2);

  await runOnce(tscBin, ["-p", "tsconfig.json"]);
  await access(resolve(process.cwd(), "dist", "index.js"));

  const child = spawnChild(process.execPath, [
    resolve(process.cwd(), "dist", "index.js"),
    ...passthroughArgs
  ]);

  child.on("exit", (code) => {
    process.exitCode = typeof code === "number" ? code : 1;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
