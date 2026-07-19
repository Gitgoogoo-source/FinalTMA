import { recordTelegramRefund } from "../../domains/risk/commands.ts";

type TelegramRefund = {
  telegram_payment_charge_id?: unknown;
  total_amount?: unknown;
};

export async function applyTelegramRefund(
  updateId: string,
  refund: TelegramRefund,
  payload: Record<string, unknown>,
): Promise<void> {
  await recordTelegramRefund(updateId, refund, payload);
}
