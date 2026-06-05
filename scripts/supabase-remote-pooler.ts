import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_POOLER_URL_FILE = "supabase/.temp/pooler-url";
const DEFAULT_SSL_MODE = "require";

function main(): void {
  const supabaseArgs = process.argv.slice(2);

  if (supabaseArgs.length === 0) {
    fail(
      "Usage: pnpm db:remote:pooler <supabase subcommand...>\n" +
        "Example: pnpm db:remote:pooler migration list",
    );
  }

  assertNoConflictingConnectionFlags(supabaseArgs);

  const password = resolvePassword();

  const dbUrl = buildPoolerDbUrl(password);
  const child = spawn("supabase", [...supabaseArgs, "--db-url", dbUrl], {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    fail(`Failed to run supabase CLI: ${error.message}`);
  });
}

function buildPoolerDbUrl(password: string): string {
  const rawPoolerUrl =
    process.env.SUPABASE_POOLER_URL ??
    readFileSync(resolve(process.cwd(), DEFAULT_POOLER_URL_FILE), "utf8");
  const poolerUrl = new URL(rawPoolerUrl.trim());

  poolerUrl.password = password;

  if (!poolerUrl.searchParams.has("sslmode")) {
    poolerUrl.searchParams.set("sslmode", DEFAULT_SSL_MODE);
  }

  return poolerUrl.toString();
}

function resolvePassword(): string {
  const envPassword = process.env.SUPABASE_DB_PASSWORD;

  if (envPassword) {
    return envPassword;
  }

  return promptForPassword();
}

function promptForPassword(): string {
  const prompt = [
    "saved=$(stty -g < /dev/tty)",
    'trap \'stty "$saved" < /dev/tty\' EXIT INT TERM',
    "printf 'Supabase DB password: ' > /dev/tty",
    "stty -echo < /dev/tty",
    "IFS= read -r password < /dev/tty",
    "printf '\\n' > /dev/tty",
    'stty "$saved" < /dev/tty',
    "trap - EXIT INT TERM",
    'printf "%s" "$password"',
  ].join("; ");
  const result = spawnSync("/bin/sh", ["-c", prompt], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.status !== 0) {
    fail(
      "Failed to read Supabase DB password. " +
        "Set SUPABASE_DB_PASSWORD in your shell and retry.",
    );
  }

  if (!result.stdout) {
    fail("Supabase DB password cannot be empty.");
  }

  return result.stdout;
}

function assertNoConflictingConnectionFlags(args: string[]): void {
  const conflictingFlags = new Set([
    "--db-url",
    "--linked",
    "--local",
    "--password",
    "-p",
  ]);
  const conflictingArg = args.find((arg) => conflictingFlags.has(arg));

  if (conflictingArg) {
    fail(
      `${conflictingArg} is managed by scripts/supabase-remote-pooler.ts. ` +
        "Run this helper without connection flags.",
    );
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();
