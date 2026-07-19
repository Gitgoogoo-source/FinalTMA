import { rpc } from "../../platform/db/index.ts";

type TelegramRefund = {
  telegram_payment_charge_id?: unknown;
  total_amount?: unknown;
};

export async function applyTelegramRefund(
  updateId: string,
  refund: TelegramRefund,
  payload: Record<string, unknown>,
): Promise<void> {
  await rpc("payment_apply_refund", {
    p_update_id: updateId,
    p_telegram_charge_id: refund.telegram_payment_charge_id,
    p_stars: refund.total_amount,
    p_payload: payload,
  });
}
