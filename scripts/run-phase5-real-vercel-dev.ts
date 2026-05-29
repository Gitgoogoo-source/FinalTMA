import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = realpathSync(process.cwd());
const tempRoot = mkdtempSync(join(tmpdir(), "finaltma-phase5-real-"));
const entries = [
  "api",
  "apps",
  "contracts",
  "node_modules",
  "packages",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.api.json",
  "tsconfig.base.json",
  "tsconfig.tests.json",
  "vercel.json",
];

for (const entry of entries) {
  const source = join(projectRoot, entry);

  if (!existsSync(source)) {
    continue;
  }

  const target = join(tempRoot, entry);
  mkdirSync(join(target, ".."), { recursive: true });
  symlinkSync(source, target);
}

const child = spawn(
  "pnpm",
  ["exec", "vercel", "dev", "--local", "--listen", "127.0.0.1:3000"],
  {
    cwd: tempRoot,
    env: process.env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
