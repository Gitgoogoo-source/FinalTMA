import { ApiError } from "../../http/errors.ts";
import { getEnv } from "../env/index.ts";

type TelegramResult<T> = { ok: boolean; result?: T; description?: string };

export class TelegramRequestError extends ApiError {
  constructor(
    readonly method: string,
    readonly definitive: boolean,
  ) {
    super(502, "TELEGRAM_API_FAILED", "Telegram 服务暂时不可用", true, {
      method,
    });
    this.name = "TelegramRequestError";
  }
}

async function callTelegram<T>(
  method: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const botToken = getEnv().TELEGRAM_BOT_TOKEN;
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
          : AbortSignal.timeout(8_000),
      },
    );
  } catch {
    throw new TelegramRequestError(method, false);
  }
  let result: TelegramResult<T>;
  try {
    result = (await response.json()) as TelegramResult<T>;
  } catch {
    throw new TelegramRequestError(method, false);
  }
  if (!response.ok || !result.ok || result.result === undefined)
    throw new TelegramRequestError(
      method,
      response.status >= 400 &&
        response.status < 500 &&
        ![408, 429].includes(response.status),
    );
  return result.result;
}

export function createInvoiceLink(input: {
  title: string;
  description: string;
  payload: string;
  stars: number;
}): Promise<string> {
  return callTelegram<string>("createInvoiceLink", {
    title: input.title,
    description: input.description,
    payload: input.payload,
    currency: "XTR",
    prices: [{ label: input.title, amount: input.stars }],
  });
}

export function answerPreCheckout(
  id: string,
  ok: boolean,
  error?: string,
): Promise<boolean> {
  return callTelegram<boolean>("answerPreCheckoutQuery", {
    pre_checkout_query_id: id,
    ok,
    ...(error ? { error_message: error } : {}),
  });
}

export function sendTelegramMessage(input: {
  chatId: number;
  text: string;
}): Promise<{ message_id: number }> {
  return callTelegram("sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    link_preview_options: { is_disabled: true },
  });
}

export function savePreparedBattleMessage(input: {
  userId: number;
  resultId: string;
  creatorDisplayName: string;
  entryFee: number;
  raritySummary: string;
  language: "en" | "zh-CN";
  deepLink: string;
  signal?: AbortSignal | undefined;
}): Promise<{ id: string; expiration_date: number }> {
  const english = input.language === "en";
  const message = english
    ? [
        `⚔️ ${input.creatorDisplayName} challenged you to a PokePets Battle`,
        `Entry fee: ${input.entryFee} Stars`,
        `Team rarity: ${input.raritySummary}`,
        "This challenge is valid for 30 minutes.",
      ].join("\n")
    : [
        `⚔️ ${input.creatorDisplayName} 向你发起宠物 Battle`,
        `入场费：${input.entryFee} Stars`,
        `阵容稀有度：${input.raritySummary}`,
        "挑战卡 30 分钟内有效",
      ].join("\n");
  return callTelegram(
    "savePreparedInlineMessage",
    {
      user_id: input.userId,
      result: {
        type: "article",
        id: input.resultId,
        title: english ? "PokePets Battle Challenge" : "PokePets Battle 挑战",
        description: `${input.entryFee} Stars · ${input.raritySummary}`,
        input_message_content: {
          message_text: message,
          link_preview_options: { is_disabled: true },
        },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: english ? "Accept Challenge" : "接受挑战",
                url: input.deepLink,
              },
            ],
          ],
        },
      },
      allow_user_chats: true,
      allow_bot_chats: false,
      allow_group_chats: true,
      allow_channel_chats: false,
    },
    input.signal,
  );
}
