import type { VercelRequest } from "@vercel/node";

import {
  ReferralLinkQuerySchema,
  type ReferralLinkQuery,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError, getHeaderValue } from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { getSupabaseAdmin } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import {
  assertNoClientControlledTaskFields,
  compactRecord,
  isRecord,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

type InviteCodeRow = {
  invite_code: string | null;
};

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      ReferralLinkQuerySchema,
      normalizeReferralLinkInput(await readOptionalJsonBody(req)),
    );
    const inviteCode = await loadInviteCode(ctx.session.userId);
    const startPayload = inviteCode;
    const inviteUrl = buildTelegramInviteUrl(startPayload);

    return compactRecord({
      referral_code: inviteCode,
      start_payload: startPayload,
      invite_url: inviteUrl,
      share_text: buildShareText(input),
      scene: input.scene,
      source: input.source,
    });
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.referral_link",
    },
  },
);

export function normalizeReferralLinkInput(
  body: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {};
  }

  assertNoClientControlledTaskFields(
    body,
    "邀请链接请求不能携带用户身份字段。",
  );

  return {
    campaignId: body.campaignId ?? body.campaign_id,
    scene: body.scene,
    source: body.source,
  };
}

async function readOptionalJsonBody(req: VercelRequest): Promise<unknown> {
  if (!requestHasBody(req)) {
    return {};
  }

  return await parseJsonBody<unknown>(req, {
    maxBytes: 8 * 1024,
  });
}

function requestHasBody(req: VercelRequest): boolean {
  if (req.body !== undefined && req.body !== null) {
    return true;
  }

  const contentLength = getHeaderValue(req.headers["content-length"]);
  return Boolean(contentLength && contentLength !== "0");
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

function buildShareText(input: ReferralLinkQuery): string {
  const configured = readString(process.env.TELEGRAM_SHARE_TEXT);
  if (configured) {
    return configured;
  }

  const source = input.source ? ` ${input.source}` : "";
  return `来一起开盲盒${source}，完成首次开盒还能获得奖励。`;
}
