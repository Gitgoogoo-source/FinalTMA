import { loadEnvFile } from "node:process";

import { callRpcRaw } from "../packages/server/src/db/rpc.js";

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  weekStart: string | null;
};

type RefreshLeaderboardPayload = {
  board_id: string;
  week_key: string;
  starts_at: string;
  ends_at: string;
  entry_count: number | string | null;
  generated_at: string;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    console.log(getHelpText());
    return;
  }

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          rpc: "api.album_refresh_weekly_leaderboard",
          args: {
            p_week_start: options.weekStart,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  loadLocalEnvFile();

  const requestId = `script-rebuild-leaderboard-${Date.now()}`;
  const startedAt = Date.now();
  const payload = await callRpcRaw<RefreshLeaderboardPayload>(
    "album_refresh_weekly_leaderboard",
    {
      p_week_start: options.weekStart,
    },
    {
      schema: "api" as never,
      context: {
        requestId,
        source: "scripts.rebuild_leaderboard",
      },
    },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestId,
        elapsedMs: Date.now() - startedAt,
        boardId: payload.board_id,
        weekKey: payload.week_key,
        startsAt: normalizeIsoDate(payload.starts_at),
        endsAt: normalizeIsoDate(payload.ends_at),
        entryCount: toNonNegativeInteger(payload.entry_count),
        generatedAt: normalizeIsoDate(payload.generated_at),
      },
      null,
      2,
    ),
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    help: false,
    weekStart: null,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--week-start=")) {
      options.weekStart = parseIsoDate(arg.slice("--week-start=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseIsoDate(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error("week-start must not be empty");
  }

  return normalizeIsoDate(trimmed);
}

function normalizeIsoDate(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return new Date(timestamp).toISOString();
}

function toNonNegativeInteger(
  value: number | string | null | undefined,
): number {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return 0;
  }

  return Math.trunc(numberValue);
}

function loadLocalEnvFile(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function getHelpText(): string {
  return [
    "Usage: pnpm ops:rebuild-leaderboard [--week-start=2026-05-25T00:00:00Z] [--dry-run]",
    "",
    "Rebuilds album.leaderboard_entries through api.album_refresh_weekly_leaderboard.",
    "If --week-start is omitted, the database refreshes the current ISO week.",
  ].join("\n");
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
