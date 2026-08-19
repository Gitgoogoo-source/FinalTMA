import { getEnv, getReferralEnv } from "../../platform/env/index.ts";

export const PAYMENT_SUPPORT_COMMAND = "/paysupport";

export function paymentSupportText(): string {
  return `Payment support: ${getEnv().PAYMENT_SUPPORT_URL}`;
}

export function isPaymentSupportCommand(text: string): boolean {
  const candidate = text.trim().toLowerCase();
  if (candidate === PAYMENT_SUPPORT_COMMAND) return true;

  const botUsername = getReferralEnv().TELEGRAM_BOT_USERNAME.toLowerCase();
  return candidate === `${PAYMENT_SUPPORT_COMMAND}@${botUsername}`;
}
