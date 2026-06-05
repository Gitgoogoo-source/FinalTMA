import type { VercelRequest } from "@vercel/node";

import {
  PreparedShareMessageBodySchema,
  type PreparedShareMessageBody,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError, getHeaderValue } from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { validate } from "../_shared/validate.js";
import {
  assertNoClientControlledTaskFields,
  compactRecord,
  isRecord,
  readNumber,
  readString,
  withTaskApiHandler,
} from "./_shared.js";
import {
  buildReferralLinkPayload,
  type ReferralLinkPayload,
} from "./referralLink.shared.js";

const TELEGRAM_BOT_API_BASE_URL = "https://api.telegram.org";
const SAVE_PREPARED_INLINE_MESSAGE_METHOD = "savePreparedInlineMessage";

type TelegramPreparedInlineMessageResult = {
  id: string;
  expirationDate: number;
};

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      PreparedShareMessageBodySchema,
      normalizePreparedShareMessageInput(await readOptionalJsonBody(req)),
    );

    if (ctx.session.telegramUserId === null) {
      throw new ApiError(
        409,
        "TELEGRAM_USER_ID_MISSING",
        "当前登录用户缺少 Telegram 身份。",
      );
    }

    const referralLink = await buildReferralLinkPayload({
      userId: ctx.session.userId,
      scene: input.scene,
      source: input.source,
    });
    const prepared = await createPreparedInviteMessage({
      telegramUserId: ctx.session.telegramUserId,
      referralLink,
    });

    return compactRecord({
      prepared_message_id: prepared.id,
      expires_at: unixSecondsToIsoString(prepared.expirationDate),
      referral_code: referralLink.referral_code,
      start_payload: referralLink.start_payload,
      invite_url: referralLink.invite_url,
      share_text: referralLink.share_text,
      scene: referralLink.scene,
      source: referralLink.source,
    });
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.prepared_share_message",
    },
  },
);

export function normalizePreparedShareMessageInput(
  body: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {};
  }

  assertNoClientControlledTaskFields(
    body,
    "预制分享消息请求不能携带用户身份字段。",
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

async function createPreparedInviteMessage(input: {
  telegramUserId: number;
  referralLink: ReferralLinkPayload;
}): Promise<TelegramPreparedInlineMessageResult> {
  const botToken = readString(process.env.TELEGRAM_BOT_TOKEN);
  if (!botToken) {
    throw new ApiError(
      500,
      "SERVER_CONFIG_ERROR",
      "缺少 TELEGRAM_BOT_TOKEN。",
      {
        expose: false,
      },
    );
  }

  const payload = await postTelegramBotApi({
    botToken,
    request: buildSavePreparedInlineMessageRequest(input),
  });
  const result = isRecord(payload.result) ? payload.result : null;
  const id = readString(result?.id);
  const expirationDate = readNumber(result?.expiration_date);

  if (!id || expirationDate === null) {
    throw new ApiError(
      502,
      "TELEGRAM_PREPARED_SHARE_RESULT_INVALID",
      "Telegram 预制分享消息结果无效。",
      {
        details: { payload },
        expose: false,
      },
    );
  }

  return {
    id,
    expirationDate,
  };
}

function buildSavePreparedInlineMessageRequest(input: {
  telegramUserId: number;
  referralLink: ReferralLinkPayload;
}): Record<string, unknown> {
  const title =
    readString(process.env.TELEGRAM_SHARE_TITLE) ?? "邀请好友开盲盒";
  const description =
    readString(process.env.TELEGRAM_SHARE_DESCRIPTION) ??
    input.referralLink.share_text;
  const imageUrl =
    readString(process.env.TELEGRAM_SHARE_IMAGE_URL) ??
    readString(process.env.TELEGRAM_SHARE_THUMBNAIL_URL);
  const buttonText =
    readString(process.env.TELEGRAM_SHARE_BUTTON_TEXT) ?? "打开游戏";

  return compactRecord({
    user_id: input.telegramUserId,
    result: compactRecord({
      type: "article",
      id: "invite_share",
      title,
      description,
      url: input.referralLink.invite_url,
      hide_url: true,
      thumbnail_url: imageUrl,
      input_message_content: compactRecord({
        message_text: buildPreparedMessageText({
          shareText: input.referralLink.share_text,
          inviteUrl: input.referralLink.invite_url,
          buttonText,
        }),
        parse_mode: "HTML",
        link_preview_options: {
          url: input.referralLink.invite_url,
          prefer_large_media: true,
        },
      }),
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: buttonText,
              url: input.referralLink.invite_url,
            },
          ],
        ],
      },
    }),
    allow_user_chats: true,
    allow_bot_chats: false,
    allow_group_chats: true,
    allow_channel_chats: true,
  });
}

function buildPreparedMessageText(input: {
  shareText: string;
  inviteUrl: string;
  buttonText: string;
}): string {
  return `${escapeHtml(input.shareText)}\n\n<a href="${escapeHtmlAttribute(
    input.inviteUrl,
  )}">${escapeHtml(input.buttonText)}</a>`;
}

async function postTelegramBotApi(input: {
  botToken: string;
  request: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (typeof globalThis.fetch !== "function") {
    throw new ApiError(
      500,
      "TELEGRAM_FETCH_UNAVAILABLE",
      "当前运行环境不支持 fetch。",
      {
        expose: false,
      },
    );
  }

  let response: Response;

  try {
    response = await globalThis.fetch(
      `${TELEGRAM_BOT_API_BASE_URL}/bot${input.botToken}/${SAVE_PREPARED_INLINE_MESSAGE_METHOD}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.request),
      },
    );
  } catch (error) {
    throw new ApiError(
      502,
      "TELEGRAM_PREPARED_SHARE_NETWORK_FAILED",
      "连接 Telegram Bot API 失败。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  const payload = await readTelegramResponseJson(response);

  if (!response.ok || payload.ok !== true) {
    throw new ApiError(
      502,
      "TELEGRAM_PREPARED_SHARE_CREATE_FAILED",
      "创建 Telegram 预制分享消息失败。",
      {
        details: sanitizeTelegramErrorPayload(payload),
        expose: false,
      },
    );
  }

  return payload;
}

async function readTelegramResponseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
}

function sanitizeTelegramErrorPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return compactRecord({
    ok: payload.ok,
    error_code: payload.error_code,
    description: readString(payload.description),
    parameters: isRecord(payload.parameters) ? payload.parameters : undefined,
  });
}

function unixSecondsToIsoString(value: number): string {
  return new Date(value * 1000).toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
