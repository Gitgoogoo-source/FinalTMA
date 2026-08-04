import { randomUUID } from "node:crypto";

import type { OperationEnvelope } from "../../http/operation-result.ts";
import { rpc } from "../../platform/db/index.ts";
import {
  getBattleEnv,
  getEnv,
  getReferralEnv,
} from "../../platform/env/index.ts";
import type { RequestTelemetry } from "../../platform/observability/index.ts";
import {
  savePreparedBattleMessage,
  TelegramRequestError,
} from "../../platform/telegram/bot.ts";
import { battleInviteToken, inviteHashMatches } from "./invite.ts";

type PreparedShareLease = {
  room_id: string;
  create_operation_id: string;
  creator_telegram_id: string | number;
  creator_display_name: string;
  rarity_summary: { rarity: string; count: number }[];
  entry_fee: number;
  invite_token_hash: string;
  attempt_count: number;
  prepare_deadline: string;
};

export type PreparedShareDelivery = {
  processed: number;
  activated: number;
  deferred: number;
  failed: number;
};

const rarityLabels: Readonly<Record<string, string>> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

export async function deliverPreparedBattleShares(
  signal?: AbortSignal,
  options: {
    limit?: number;
    roomId?: string;
    telemetry?: RequestTelemetry | null;
  } = {},
): Promise<PreparedShareDelivery> {
  getBattleEnv();
  getEnv();
  getReferralEnv();
  const limit = options.limit ?? 10;
  const leaseOwner = randomUUID();
  const leases = await rpc<PreparedShareLease[]>(
    "battle_claim_prepared_shares",
    {
      p_lease_owner: leaseOwner,
      p_limit: limit,
      p_room_id: options.roomId ?? null,
    },
    { signal, telemetry: options.telemetry },
  );
  const result: PreparedShareDelivery = {
    processed: leases.length,
    activated: 0,
    deferred: 0,
    failed: 0,
  };
  const outcomes = await Promise.all(
    leases.map((lease) =>
      deliverOne(lease, leaseOwner, signal, options.telemetry),
    ),
  );
  for (const outcome of outcomes) {
    result[outcome] += 1;
  }
  return result;
}

async function deliverOne(
  lease: PreparedShareLease,
  leaseOwner: string,
  signal?: AbortSignal,
  telemetry?: RequestTelemetry | null,
): Promise<"activated" | "deferred" | "failed"> {
  const token = battleInviteToken(lease.create_operation_id);
  if (!inviteHashMatches(token, lease.invite_token_hash)) {
    await nack(
      lease.room_id,
      leaseOwner,
      "INVITE_TOKEN_HASH_MISMATCH",
      signal,
      telemetry,
    );
    return "deferred";
  }
  const userId = telegramUserId(lease.creator_telegram_id);
  const raritySummary = formatRaritySummary(lease.rarity_summary);
  const deepLink = battleDeepLink(token);
  let prepared: { id: string; expiration_date: number };
  try {
    prepared = await savePreparedBattleMessage({
      userId,
      resultId: `battle-${lease.create_operation_id}`,
      creatorDisplayName: lease.creator_display_name,
      entryFee: lease.entry_fee,
      raritySummary,
      deepLink,
      signal,
    });
  } catch (cause) {
    if (!(cause instanceof TelegramRequestError)) throw cause;
    if (cause.definitive) {
      await rpc<OperationEnvelope>(
        "battle_abort_share",
        {
          p_room_id: lease.room_id,
          p_error: "TELEGRAM_PREPARED_MESSAGE_REJECTED",
        },
        { signal, telemetry },
      );
      return "failed";
    }
    await nack(
      lease.room_id,
      leaseOwner,
      "TELEGRAM_RESULT_UNKNOWN",
      signal,
      telemetry,
    );
    return "deferred";
  }
  try {
    await rpc<OperationEnvelope>(
      "battle_activate_share",
      {
        p_room_id: lease.room_id,
        p_prepared_message_id: prepared.id,
        p_telegram_expires_at: new Date(
          prepared.expiration_date * 1000,
        ).toISOString(),
      },
      { signal, telemetry },
    );
    return "activated";
  } catch {
    await nack(
      lease.room_id,
      leaseOwner,
      "LOCAL_ACTIVATION_UNKNOWN",
      signal,
      telemetry,
    );
    return "deferred";
  }
}

async function nack(
  roomId: string,
  leaseOwner: string,
  code: string,
  signal?: AbortSignal,
  telemetry?: RequestTelemetry | null,
): Promise<void> {
  await rpc(
    "battle_nack_prepared_share",
    {
      p_room_id: roomId,
      p_lease_owner: leaseOwner,
      p_error_code: code,
    },
    { signal, telemetry },
  );
}

function telegramUserId(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("Invalid Telegram user id from database");
  return parsed;
}

function formatRaritySummary(
  summary: PreparedShareLease["rarity_summary"],
): string {
  return summary
    .map((item) => {
      const label = rarityLabels[item.rarity];
      if (!label || !Number.isInteger(item.count) || item.count < 1)
        throw new Error("Invalid Battle rarity summary from database");
      return `${label} ×${item.count}`;
    })
    .join("、");
}

function battleDeepLink(token: string): string {
  const env = getReferralEnv();
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}/${env.TELEGRAM_MINI_APP_SHORT_NAME}?startapp=${token}`;
}
