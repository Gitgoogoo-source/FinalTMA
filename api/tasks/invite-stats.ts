import type { VercelRequest } from "@vercel/node";

import {
  InviteStatsQuerySchema,
  type InviteStatsQuery,
} from "../../packages/validation/src/task.schemas.js";
import { validate } from "../_shared/validate.js";
import {
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  compactRecord,
  firstQueryValue,
  isRecord,
  mapTaskRpcError,
  readNumber,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      InviteStatsQuerySchema,
      normalizeInviteStatsQuery(req),
    );
    const payload = await callInviteStatsRpc(input, ctx.session, ctx.requestId);

    return normalizeInviteStatsPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "tasks.invite_stats",
    },
  },
);

export function normalizeInviteStatsQuery(
  req: VercelRequest,
): Record<string, unknown> {
  return {
    campaignId: firstQueryValue(req.query.campaignId ?? req.query.campaign_id),
    from: firstQueryValue(req.query.from),
    to: firstQueryValue(req.query.to),
  };
}

async function callInviteStatsRpc(
  input: InviteStatsQuery,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "referral_get_invite_stats",
      session,
      {
        p_from: dateOnlyToUtcStart(input.from),
        p_to: dateOnlyToNextUtcStart(input.to),
      },
      {
        requestId,
        from: input.from ?? null,
        to: input.to ?? null,
        campaignId: input.campaignId ?? null,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "REFERRAL_INVITE_STATS_RPC_FAILED",
      "获取邀请统计失败，请稍后重试。",
    );
  }
}

export function normalizeInviteStatsPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "REFERRAL_INVITE_STATS_RESULT_INVALID",
    "邀请统计结果格式无效。",
  );
  const referrals = isRecord(result.referrals) ? result.referrals : {};
  const rewards = isRecord(result.rewards) ? result.rewards : {};
  const commissions = isRecord(result.commissions) ? result.commissions : {};
  const shares = isRecord(result.shares) ? result.shares : {};
  const summary = isRecord(result.summary) ? result.summary : {};
  const kcoinRewards = isRecord(rewards.KCOIN) ? rewards.KCOIN : {};
  const qualifiedCount = readInteger(referrals.qualified_count) ?? 0;
  const rewardedCount = readInteger(referrals.rewarded_count) ?? 0;
  const firstOpenCount =
    readInteger(summary.first_open_count) ??
    readInteger(referrals.first_open_count) ??
    qualifiedCount + rewardedCount;
  const validInviteCount =
    readInteger(summary.valid_invite_count) ??
    readInteger(referrals.valid_count) ??
    Math.max(qualifiedCount + rewardedCount, firstOpenCount);
  const pendingCommissionKcoin =
    readInteger(summary.pending_commission_kcoin) ??
    readInteger(commissions.pending_amount_kcoin) ??
    0;
  const grantedCommissionKcoin =
    readInteger(summary.granted_commission_kcoin) ??
    readInteger(summary.commission_kcoin) ??
    readInteger(commissions.granted_amount_kcoin) ??
    0;
  const totalCommissionKcoin =
    readInteger(summary.total_commission_kcoin) ??
    readInteger(commissions.total_amount_kcoin) ??
    pendingCommissionKcoin + grantedCommissionKcoin;
  const commissionBps =
    readInteger(summary.commission_bps) ??
    readInteger(commissions.current_bps) ??
    readInteger(commissions.commission_bps) ??
    null;
  const commissionRate =
    readNumber(summary.commission_rate) ??
    readNumber(commissions.current_rate) ??
    (commissionBps !== null ? commissionBps / 10000 : 0);

  return {
    referrals,
    rewards,
    commissions,
    shares,
    date_range: isRecord(result.date_range) ? result.date_range : {},
    summary: compactRecord({
      invited_count:
        readInteger(summary.invited_count) ??
        readInteger(referrals.total_count) ??
        0,
      valid_invite_count: validInviteCount,
      first_open_count: firstOpenCount,
      total_reward_kcoin:
        readInteger(summary.total_reward_kcoin) ??
        readInteger(kcoinRewards.amount) ??
        0,
      pending_commission_kcoin: pendingCommissionKcoin,
      granted_commission_kcoin: grantedCommissionKcoin,
      commission_kcoin: grantedCommissionKcoin,
      total_commission_kcoin: totalCommissionKcoin,
      commission_bps: commissionBps,
      commission_rate: commissionRate,
      share_count:
        readInteger(summary.share_count) ??
        readInteger(shares.total_count) ??
        0,
    }),
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function dateOnlyToUtcStart(value: string | undefined): string | null {
  return value ? `${value}T00:00:00.000Z` : null;
}

function dateOnlyToNextUtcStart(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function readInteger(value: unknown): number | null {
  const numberValue = readNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}
