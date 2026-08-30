#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isVercelProduction =
  process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

if (!isVercelProduction) process.exit(0);

if (process.env.APP_ENV !== "production") {
  throw new Error(
    "Vercel production builds require APP_ENV=production before Catalog readiness can be checked",
  );
}

const result = spawnSync(
  process.execPath,
  [
    resolve(root, "tools/assets/release.mjs"),
    "status",
    "--manifest",
    resolve(root, "generated/assets/art-assets-v2.json"),
  ],
  { cwd: root, env: process.env, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error("Catalog release readiness blocked the production build");
