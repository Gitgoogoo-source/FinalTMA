import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const statusResult = spawnSync("supabase", ["status", "--output", "env"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (statusResult.status !== 0) {
  process.stderr.write(statusResult.stderr);
  process.stderr.write(
    "\nUnable to read local Supabase status. Start Supabase locally with `pnpm db:start` before running Phase 5 real E2E tests.\n",
  );
  process.exit(statusResult.status ?? 1);
}

const localSupabaseEnv = parseEnvOutput(statusResult.stdout);
const localFileEnv = readLocalEnvFile();
const supabaseUrl = requireLocalSupabaseUrl(
  localSupabaseEnv.API_URL ?? localSupabaseEnv.SUPABASE_URL,
);
const anonKey = localSupabaseEnv.ANON_KEY ?? localSupabaseEnv.SUPABASE_ANON_KEY;
const serviceRoleKey =
  localSupabaseEnv.SERVICE_ROLE_KEY ??
  localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY;
const botToken =
  process.env.PHASE5_REAL_E2E_BOT_TOKEN ??
  localFileEnv.TELEGRAM_BOT_TOKEN ??
  "123456789:phase5-real-e2e-bot-token";

if (!anonKey || !serviceRoleKey) {
  throw new Error("Local Supabase anon and service role keys are required.");
}

const testResult = spawnSync(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.phase5-real.config.ts",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PHASE5_REAL_E2E: "1",
      PHASE5_REAL_E2E_SUPABASE_URL: supabaseUrl,
      PHASE5_REAL_E2E_SUPABASE_ANON_KEY: anonKey,
      PHASE5_REAL_E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      PHASE5_REAL_E2E_BOT_TOKEN: botToken,
    },
  },
);

process.exit(testResult.status ?? 1);

function parseEnvOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    values[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return values;
}

function readLocalEnvFile(): Record<string, string> {
  if (!existsSync(".env")) {
    return {};
  }

  return parseEnvOutput(readFileSync(".env", "utf8"));
}

function requireLocalSupabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("Local Supabase API URL is required.");
  }

  const url = new URL(value);

  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(
      `Refusing to run Phase 5 real E2E tests against non-local Supabase URL: ${url.origin}`,
    );
  }

  return value;
}
