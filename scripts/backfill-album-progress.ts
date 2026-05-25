import { loadEnvFile } from "node:process";

import { callRpcRaw } from "../packages/server/src/db/rpc.js";

type OwnedInventoryStatus =
  | "available"
  | "locked"
  | "listed"
  | "minting"
  | "minted";

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  source: string;
  statuses: OwnedInventoryStatus[];
};

type AlbumBackfillPayload = {
  dry_run: boolean;
  source: string;
  statuses: OwnedInventoryStatus[];
  candidate_item_count: number | string | null;
  current_item_candidate_count?: number | string | null;
  event_item_candidate_count?: number | string | null;
  candidate_user_template_count: number | string | null;
  existing_discovery_count: number | string | null;
  missing_discovery_count: number | string | null;
  inserted_discovery_count: number | string | null;
};

const DEFAULT_SOURCE = "scripts.backfill_album_progress";
const DEFAULT_STATUSES: OwnedInventoryStatus[] = [
  "available",
  "locked",
  "listed",
  "minting",
  "minted",
];

const OWNED_STATUS_SET = new Set<string>(DEFAULT_STATUSES);

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    console.log(getHelpText());
    return;
  }

  loadLocalEnvFile();

  const requestId = `script-backfill-album-progress-${Date.now()}`;
  const startedAt = Date.now();
  const payload = await callRpcRaw<AlbumBackfillPayload>(
    "album_backfill_discoveries_from_inventory",
    {
      p_dry_run: options.dryRun,
      p_source: options.source,
      p_statuses: options.statuses,
    },
    {
      schema: "api" as never,
      context: {
        requestId,
        source: options.source,
      },
    },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestId,
        elapsedMs: Date.now() - startedAt,
        dryRun: payload.dry_run,
        source: payload.source,
        statuses: payload.statuses,
        candidateItemCount: toNonNegativeInteger(payload.candidate_item_count),
        currentItemCandidateCount: toNonNegativeInteger(
          payload.current_item_candidate_count,
        ),
        eventItemCandidateCount: toNonNegativeInteger(
          payload.event_item_candidate_count,
        ),
        candidateUserTemplateCount: toNonNegativeInteger(
          payload.candidate_user_template_count,
        ),
        existingDiscoveryCount: toNonNegativeInteger(
          payload.existing_discovery_count,
        ),
        missingDiscoveryCount: toNonNegativeInteger(
          payload.missing_discovery_count,
        ),
        insertedDiscoveryCount: toNonNegativeInteger(
          payload.inserted_discovery_count,
        ),
      },
      null,
      2,
    ),
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: true,
    help: false,
    source: DEFAULT_SOURCE,
    statuses: [...DEFAULT_STATUSES],
  };
  let selectedMode: "apply" | "dry-run" | null = null;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      if (selectedMode === "apply") {
        throw new Error("--apply and --dry-run cannot be used together");
      }

      selectedMode = "dry-run";
      options.dryRun = true;
      continue;
    }

    if (arg === "--apply") {
      if (selectedMode === "dry-run") {
        throw new Error("--apply and --dry-run cannot be used together");
      }

      selectedMode = "apply";
      options.dryRun = false;
      continue;
    }

    if (arg.startsWith("--source=")) {
      options.source = parseNonEmptyString(
        arg.slice("--source=".length),
        "source",
      );
      continue;
    }

    if (arg.startsWith("--statuses=")) {
      options.statuses = parseStatuses(arg.slice("--statuses=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseStatuses(value: string): OwnedInventoryStatus[] {
  const statuses = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (statuses.length === 0) {
    throw new Error("statuses must include at least one status");
  }

  for (const status of statuses) {
    if (!OWNED_STATUS_SET.has(status)) {
      throw new Error(
        `Unsupported status "${status}". Allowed statuses: ${DEFAULT_STATUSES.join(", ")}`,
      );
    }
  }

  return statuses as OwnedInventoryStatus[];
}

function parseNonEmptyString(value: string, name: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }

  return trimmed;
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
    "Usage: pnpm ops:backfill-album [--dry-run|--apply] [--statuses=available,locked,listed,minting,minted]",
    "",
    "Backfills album.user_discoveries through api.album_backfill_discoveries_from_inventory.",
    "Default mode previews only. Pass --apply to write missing discoveries.",
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
