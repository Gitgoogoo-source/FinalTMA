import { ApiError } from "../_shared/handler.js";
import { getSupabaseAdmin } from "../_shared/requireSession.js";
import { readString } from "./_shared.js";

export type ReferralLinkBuildInput = {
  userId: string;
  scene?: string | null | undefined;
  source?: string | null | undefined;
};

export type ReferralLinkPayload = {
  referral_code: string;
  start_payload: string;
  invite_url: string;
  share_text: string;
  scene?: string | null;
  source?: string | null;
};

type InviteCodeRow = {
  invite_code: string | null;
};

export async function buildReferralLinkPayload(
  input: ReferralLinkBuildInput,
): Promise<ReferralLinkPayload> {
  const inviteCode = await loadInviteCode(input.userId);
  const startPayload = inviteCode;

  return {
    referral_code: inviteCode,
    start_payload: startPayload,
    invite_url: buildTelegramInviteUrl(startPayload),
    share_text: buildShareText(input),
    scene: input.scene ?? null,
    source: input.source ?? null,
  };
}

async function loadInviteCode(userId: string): Promise<string> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select("invite_code")
    .eq("id", userId)
    .maybeSingle<InviteCodeRow>();

  if (error) {
    throw new ApiError(500, "REFERRAL_LINK_LOOKUP_FAILED", "查询邀请码失败。", {
      details: error,
      expose: false,
    });
  }

  const inviteCode = readString(data?.invite_code);
  if (!inviteCode) {
    throw new ApiError(
      500,
      "REFERRAL_INVITE_CODE_MISSING",
      "当前用户邀请码缺失。",
      {
        expose: false,
      },
    );
  }

  return inviteCode;
}

function buildTelegramInviteUrl(startPayload: string): string {
  const botUsername = readString(process.env.TELEGRAM_BOT_USERNAME)?.replace(
    /^@/,
    "",
  );

  if (!botUsername) {
    throw new ApiError(
      500,
      "SERVER_CONFIG_ERROR",
      "缺少 TELEGRAM_BOT_USERNAME。",
      {
        expose: false,
      },
    );
  }

  const encodedPayload = encodeURIComponent(startPayload);
  const miniAppShortName = readString(process.env.TELEGRAM_MINI_APP_SHORT_NAME);

  if (miniAppShortName) {
    return `https://t.me/${encodeURIComponent(botUsername)}/${encodeURIComponent(
      miniAppShortName,
    )}?startapp=${encodedPayload}`;
  }

  return `https://t.me/${encodeURIComponent(botUsername)}?start=${encodedPayload}`;
}

function buildShareText(input: Pick<ReferralLinkBuildInput, "source">): string {
  const configured = readString(process.env.TELEGRAM_SHARE_TEXT);
  if (configured) {
    return configured;
  }

  const source = input.source ? ` ${input.source}` : "";
  return `来一起开盲盒${source}，完成首次开盒还能获得奖励。`;
}
