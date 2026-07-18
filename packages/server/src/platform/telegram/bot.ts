import { ApiError } from "../../http/errors.ts";
import { getEnv } from "../env/index.ts";

type TelegramResult<T> = { ok: boolean; result?: T; description?: string };

async function callTelegram<T>(
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${getEnv().TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const result = (await response.json()) as TelegramResult<T>;
  if (!response.ok || !result.ok || result.result === undefined)
    throw new ApiError(
      502,
      "TELEGRAM_API_FAILED",
      "Telegram 服务暂时不可用",
      true,
      { method, description: result.description },
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
