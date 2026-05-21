import { describe, expect, it } from "vitest";
import {
  buildCreateOpenOrderResponse,
  isDevGachaPaymentModeEnabled,
  normalizeCreateOpenOrderInput,
} from "../../api/boxes/create-open-order";

const BOX_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const STAR_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "open:test-idempotency-001";

describe("boxes API helpers", () => {
  it("normalizes first-phase snake_case create-order input", () => {
    expect(
      normalizeCreateOpenOrderInput(
        {
          box_id: BOX_ID,
          draw_count: 10,
          idempotency_key: IDEMPOTENCY_KEY,
        },
        null,
      ),
    ).toMatchObject({
      boxId: BOX_ID,
      openType: "ten",
      quantity: 10,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("uses the idempotency header when the body omits idempotency_key", () => {
    expect(
      normalizeCreateOpenOrderInput(
        {
          box_id: BOX_ID,
          draw_count: 1,
        },
        IDEMPOTENCY_KEY,
      ),
    ).toMatchObject({
      openType: "single",
      quantity: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("detects enabled dev gacha payment modes", () => {
    expect(isDevGachaPaymentModeEnabled("true")).toBe(true);
    expect(isDevGachaPaymentModeEnabled("1")).toBe(true);
    expect(isDevGachaPaymentModeEnabled("false")).toBe(false);
    expect(isDevGachaPaymentModeEnabled(undefined)).toBe(false);
  });

  it("marks dev-paid opened orders as result-ready", () => {
    const response = buildCreateOpenOrderResponse(
      {
        draw_order_id: ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        invoice_payload: `gacha:${ORDER_ID}`,
        xtr_amount: 90,
        quantity: 10,
        discount_bps: 1000,
        idempotent: false,
      },
      {
        boxId: BOX_ID,
        openType: "ten",
        quantity: 10,
        paymentProvider: "telegram_stars",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      {
        draw_order_id: ORDER_ID,
        status: "opened",
        payment_status: "dev_paid",
      },
    );

    expect(response).toMatchObject({
      order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      draw_count: 10,
      order_status: "opened",
      payment_status: "dev_paid",
      dev_payment_processed: true,
      result_ready: true,
    });
  });
});
