import { rpc } from "../../platform/db/index.ts";
import {
  sendTelegramMessage,
  TelegramRequestError,
} from "../../platform/telegram/bot.ts";

const EVOMYPET_MINI_APP_URL = "https://t.me/EvoMyPet_bot/evomypet";

type ClaimResult = {
  should_send: boolean;
  user_id: string | null;
  preferred_language: "en" | "zh-CN" | null;
};

export async function processTelegramChatOnboarding(
  update: Record<string, unknown>,
): Promise<boolean> {
  const updateId = update.update_id;
  const message = asRecord(update.message);
  const chat = asRecord(message?.chat);
  const from = asRecord(message?.from);
  const permission = asRecord(message?.write_access_allowed);
  if (!permission) return false;
  if (
    permission.from_request !== true ||
    chat?.type !== "private" ||
    !isPositiveSafeInteger(chat.id) ||
    !isPositiveSafeInteger(from?.id) ||
    from?.is_bot === true ||
    from.id !== chat.id ||
    !isNonnegativeSafeInteger(updateId)
  )
    return true;

  const claim = await rpc<ClaimResult>("telegram_chat_onboarding_claim", {
    p_update_id: updateId,
    p_telegram_id: from.id,
    p_payload: update,
  });
  if (!claim.should_send || !claim.user_id) return true;

  const language = claim.preferred_language === "zh-CN" ? "zh-CN" : "en";
  try {
    const sent = await sendTelegramMessage({
      chatId: chat.id,
      ...welcomeMessage(language),
    });
    await finishClaim(claim.user_id, updateId, "sent", sent.message_id);
  } catch (cause) {
    if (cause instanceof TelegramRequestError) {
      await finishClaim(
        claim.user_id,
        updateId,
        cause.definitive ? "failed" : "unknown",
        null,
      ).catch(() => undefined);
    }
    throw cause;
  }
  return true;
}

function welcomeMessage(language: "en" | "zh-CN"): {
  text: string;
  button: { text: string; url: string };
} {
  if (language === "zh-CN")
    return {
      text: "欢迎来到 EvoMyPet！🐾\n你的冒险已经准备好了，以后可以随时从这个聊天打开游戏。",
      button: { text: "打开 EvoMyPet", url: EVOMYPET_MINI_APP_URL },
    };
  return {
    text: "Welcome to EvoMyPet! 🐾\nYour adventure is ready. Open the game anytime from this chat.",
    button: { text: "Open EvoMyPet", url: EVOMYPET_MINI_APP_URL },
  };
}

async function finishClaim(
  userId: string,
  updateId: number,
  status: "unknown" | "sent" | "failed",
  messageId: number | null,
): Promise<void> {
  await rpc("telegram_chat_onboarding_finish", {
    p_user_id: userId,
    p_update_id: updateId,
    p_delivery_status: status,
    p_welcome_message_id: messageId,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
