import { describe, expect, it, vi } from "vitest";

import type { SupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin";
import {
  buildAnswerPreCheckoutQueryRequest,
  buildTelegramStarsInvoiceRequest,
  createTelegramStarsInvoice,
  parseAnswerPreCheckoutQueryResponse,
  parseCreateInvoiceLinkResponse,
  parseTelegramSuccessfulPaymentUpdate,
  parseTelegramPreCheckoutUpdate,
  processTelegramSuccessfulPaymentUpdate,
  TelegramStarsInvoiceError,
  TelegramStarsWebhookError,
} from "../../packages/server/src/payments/telegramStars";

const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const STAR_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const PAYLOAD =
  "gacha_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const INVOICE_LINK = "https://t.me/invoice/test-open-order";
const EXPIRES_AT = "2026-05-28T00:15:00.000Z";

type MockState = {
  rpcCalls: Array<{
    schema: string;
    name: string;
    args: Record<string, unknown>;
  }>;
};

describe("telegramStars payment helpers", () => {
  it("builds a Telegram Stars createInvoiceLink request without leaking provider token in tests", () => {
    const request = buildTelegramStarsInvoiceRequest({
      title: "Legendary Box",
      description: "Open blind box x10",
      payload: PAYLOAD,
      xtrAmount: 90,
      providerToken: "",
    });

    expect(request).toMatchObject({
      title: "Legendary Box",
      description: "Open blind box x10",
      payload: PAYLOAD,
      provider_token: "",
      currency: "XTR",
      prices: [
        {
          label: "Legendary Box",
          amount: 90,
        },
      ],
    });
  });

  it("parses valid Bot API invoice links and rejects failed responses", () => {
    expect(
      parseCreateInvoiceLinkResponse({
        ok: true,
        result: INVOICE_LINK,
      }),
    ).toBe(INVOICE_LINK);

    expect(() =>
      parseCreateInvoiceLinkResponse({
        ok: false,
        description: "Bad Request: invalid payload",
      }),
    ).toThrow(TelegramStarsInvoiceError);
  });

  it("parses pre_checkout_query updates and builds answerPreCheckoutQuery requests", () => {
    const update = {
      update_id: 95050001,
      pre_checkout_query: {
        id: "pcq-test-001",
        from: {
          id: 7050001,
          first_name: "Test",
        },
        currency: "XTR",
        total_amount: 90,
        invoice_payload: PAYLOAD,
      },
    };

    expect(parseTelegramPreCheckoutUpdate(update)).toEqual({
      updateId: 95050001,
      preCheckoutQuery: {
        id: "pcq-test-001",
        fromId: 7050001,
        currency: "XTR",
        totalAmount: 90,
        invoicePayload: PAYLOAD,
      },
    });

    expect(
      buildAnswerPreCheckoutQueryRequest({
        preCheckoutQueryId: "pcq-test-001",
        ok: true,
      }),
    ).toEqual({
      pre_checkout_query_id: "pcq-test-001",
      ok: true,
    });

    expect(
      buildAnswerPreCheckoutQueryRequest({
        preCheckoutQueryId: "pcq-test-001",
        ok: false,
        errorMessage: "订单已过期，请重新下单。",
      }),
    ).toEqual({
      pre_checkout_query_id: "pcq-test-001",
      ok: false,
      error_message: "订单已过期，请重新下单。",
    });
  });

  it("parses successful_payment updates", () => {
    const update = {
      update_id: 96060001,
      message: {
        message_id: 777,
        from: {
          id: 7050001,
          first_name: "Test",
        },
        successful_payment: {
          currency: "XTR",
          total_amount: 90,
          invoice_payload: PAYLOAD,
          telegram_payment_charge_id: "tg-charge-test-001",
          provider_payment_charge_id: "provider-charge-test-001",
        },
      },
    };

    expect(parseTelegramSuccessfulPaymentUpdate(update)).toEqual({
      updateId: 96060001,
      successfulPayment: {
        fromId: 7050001,
        currency: "XTR",
        totalAmount: 90,
        invoicePayload: PAYLOAD,
        telegramPaymentChargeId: "tg-charge-test-001",
        providerPaymentChargeId: "provider-charge-test-001",
      },
    });
  });

  it("records then fulfills successful_payment updates through the paid-order RPC", async () => {
    const rpcCalls: Array<{
      schema: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const client = {
      schema(schema: string) {
        return {
          rpc(name: string, args: Record<string, unknown>) {
            rpcCalls.push({
              schema,
              name,
              args,
            });

            if (name === "payment_record_successful_payment") {
              return Promise.resolve({
                data: {
                  payment_recorded: true,
                  idempotent: false,
                  duplicate_update: false,
                  duplicate_charge: false,
                  event_id: "55555555-5555-4555-8555-555555555555",
                  star_order_id: STAR_ORDER_ID,
                  star_payment_id: "77777777-7777-4777-8777-777777777777",
                  draw_order_id: ORDER_ID,
                  invoice_payload: PAYLOAD,
                  telegram_payment_charge_id: "tg-charge-test-001",
                  reason_code: null,
                  error_message: null,
                  payment_order_status: "paid",
                  process_status: "processed",
                  paid_at: "2026-05-28T05:06:20.000Z",
                },
                error: null,
                count: null,
                status: 200,
                statusText: "OK",
              });
            }

            return Promise.resolve({
              data: {
                fulfilled: true,
                idempotent: false,
                status: "completed",
                star_order_id: STAR_ORDER_ID,
                draw_order_id: ORDER_ID,
                draw_count: 1,
                quantity: 1,
                result_count: 1,
                reason_code: null,
                error_message: null,
                payment_order_status: "fulfilled",
                retryable: false,
              },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          },
        };
      },
    } as unknown as SupabaseAdminClient;

    const result = await processTelegramSuccessfulPaymentUpdate({
      update: {
        update_id: 96060001,
        message: {
          from: {
            id: 7050001,
          },
          successful_payment: {
            currency: "XTR",
            total_amount: 90,
            invoice_payload: PAYLOAD,
            telegram_payment_charge_id: "tg-charge-test-001",
            provider_payment_charge_id: "provider-charge-test-001",
          },
        },
      },
      requestId: "req_test_successful_payment_fulfillment",
      requestHeadersHash: "headers-hash",
      webhookSecretVerified: true,
      client,
      env: {
        FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: "true",
      } as NodeJS.ProcessEnv,
    });

    expect(rpcCalls.map((call) => call.name)).toEqual([
      "payment_record_successful_payment",
      "ops_read_feature_flag",
      "gacha_process_paid_order",
    ]);
    expect(rpcCalls[1]?.args).toMatchObject({
      p_key: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
    });
    expect(rpcCalls[2]?.args).toMatchObject({
      p_star_order_id: STAR_ORDER_ID,
      p_telegram_payment_charge_id: "tg-charge-test-001",
      p_provider_payment_charge_id: "provider-charge-test-001",
    });
    expect(result).toMatchObject({
      eventType: "successful_payment",
      paymentRecorded: true,
      paymentOrderStatus: "fulfilled",
      processStatus: "processed",
      fulfillmentAttempted: true,
      fulfillment: {
        fulfilled: true,
        status: "completed",
        paymentOrderStatus: "fulfilled",
      },
    });
  });

  it("records successful_payment without fulfillment when the webhook fulfillment switch is paused", async () => {
    const rpcCalls: Array<{
      schema: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const client = {
      schema(schema: string) {
        return {
          rpc(name: string, args: Record<string, unknown>) {
            rpcCalls.push({
              schema,
              name,
              args,
            });

            return Promise.resolve({
              data: {
                payment_recorded: true,
                idempotent: false,
                duplicate_update: false,
                duplicate_charge: false,
                event_id: "55555555-5555-4555-8555-555555555560",
                star_order_id: STAR_ORDER_ID,
                star_payment_id: "77777777-7777-4777-8777-777777777779",
                draw_order_id: ORDER_ID,
                invoice_payload: PAYLOAD,
                telegram_payment_charge_id: "tg-charge-paused-001",
                reason_code: null,
                error_message: null,
                payment_order_status: "paid",
                process_status: "processed",
                paid_at: "2026-05-28T05:06:20.000Z",
              },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          },
        };
      },
    } as unknown as SupabaseAdminClient;

    const result = await processTelegramSuccessfulPaymentUpdate({
      update: {
        update_id: 96060010,
        message: {
          from: {
            id: 7050001,
          },
          successful_payment: {
            currency: "XTR",
            total_amount: 90,
            invoice_payload: PAYLOAD,
            telegram_payment_charge_id: "tg-charge-paused-001",
            provider_payment_charge_id: "provider-charge-paused-001",
          },
        },
      },
      requestId: "req_test_successful_payment_fulfillment_paused",
      requestHeadersHash: "headers-hash",
      webhookSecretVerified: true,
      client,
      env: {
        FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: "false",
      } as NodeJS.ProcessEnv,
    });

    expect(rpcCalls.map((call) => call.name)).toEqual([
      "payment_record_successful_payment",
      "ops_read_feature_flag",
    ]);
    expect(rpcCalls[1]?.args).toMatchObject({
      p_key: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
    });
    expect(result).toMatchObject({
      eventType: "successful_payment",
      paymentRecorded: true,
      paymentOrderStatus: "paid",
      processStatus: "processed",
      fulfillmentAttempted: false,
      fulfillment: null,
    });
  });

  it("does not fulfill successful_payment updates when recording rejects the order", async () => {
    const rpcCalls: Array<{
      schema: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const client = {
      schema(schema: string) {
        return {
          rpc(name: string, args: Record<string, unknown>) {
            rpcCalls.push({
              schema,
              name,
              args,
            });

            return Promise.resolve({
              data: {
                payment_recorded: false,
                idempotent: false,
                duplicate_update: false,
                duplicate_charge: false,
                event_id: "55555555-5555-4555-8555-555555555558",
                star_order_id: null,
                star_payment_id: null,
                draw_order_id: null,
                invoice_payload: PAYLOAD,
                telegram_payment_charge_id: "tg-charge-missing-order-001",
                reason_code: "ORDER_NOT_FOUND",
                error_message: "Stars 订单不存在。",
                payment_order_status: null,
                process_status: "failed",
                paid_at: null,
              },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          },
        };
      },
    } as unknown as SupabaseAdminClient;

    const result = await processTelegramSuccessfulPaymentUpdate({
      update: {
        update_id: 96060008,
        message: {
          from: {
            id: 7050001,
          },
          successful_payment: {
            currency: "XTR",
            total_amount: 90,
            invoice_payload: PAYLOAD,
            telegram_payment_charge_id: "tg-charge-missing-order-001",
            provider_payment_charge_id: "provider-charge-missing-order-001",
          },
        },
      },
      requestId: "req_test_successful_payment_missing_order",
      requestHeadersHash: "headers-hash",
      webhookSecretVerified: true,
      client,
      env: {
        FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: "true",
      } as NodeJS.ProcessEnv,
    });

    expect(rpcCalls.map((call) => call.name)).toEqual([
      "payment_record_successful_payment",
    ]);
    expect(result).toMatchObject({
      eventType: "successful_payment",
      paymentRecorded: false,
      reasonCode: "ORDER_NOT_FOUND",
      processStatus: "failed",
      fulfillmentAttempted: false,
      fulfillment: null,
    });
  });

  it("surfaces paid-order fulfillment failures after payment recording succeeds", async () => {
    const rpcCalls: Array<{
      schema: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const client = {
      schema(schema: string) {
        return {
          rpc(name: string, args: Record<string, unknown>) {
            rpcCalls.push({
              schema,
              name,
              args,
            });

            if (name === "payment_record_successful_payment") {
              return Promise.resolve({
                data: {
                  payment_recorded: true,
                  idempotent: false,
                  duplicate_update: false,
                  duplicate_charge: false,
                  event_id: "55555555-5555-4555-8555-555555555559",
                  star_order_id: STAR_ORDER_ID,
                  star_payment_id: "77777777-7777-4777-8777-777777777778",
                  draw_order_id: ORDER_ID,
                  invoice_payload: PAYLOAD,
                  telegram_payment_charge_id:
                    "tg-charge-fulfillment-failed-001",
                  reason_code: null,
                  error_message: null,
                  payment_order_status: "paid",
                  process_status: "processed",
                  paid_at: "2026-05-28T05:06:20.000Z",
                },
                error: null,
                count: null,
                status: 200,
                statusText: "OK",
              });
            }

            return Promise.resolve({
              data: {
                fulfilled: false,
                idempotent: false,
                status: "failed",
                star_order_id: STAR_ORDER_ID,
                draw_order_id: ORDER_ID,
                draw_count: 1,
                quantity: 1,
                result_count: 0,
                reason_code: "DROP_POOL_EMPTY",
                error_message: "Drop pool is empty.",
                payment_order_status: "failed",
                retryable: true,
              },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          },
        };
      },
    } as unknown as SupabaseAdminClient;

    const result = await processTelegramSuccessfulPaymentUpdate({
      update: {
        update_id: 96060009,
        message: {
          from: {
            id: 7050001,
          },
          successful_payment: {
            currency: "XTR",
            total_amount: 90,
            invoice_payload: PAYLOAD,
            telegram_payment_charge_id: "tg-charge-stock-failed-001",
            provider_payment_charge_id: "provider-charge-stock-failed-001",
          },
        },
      },
      requestId: "req_test_successful_payment_fulfillment_failed",
      requestHeadersHash: "headers-hash",
      webhookSecretVerified: true,
      client,
      env: {
        FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: "true",
      } as NodeJS.ProcessEnv,
    });

    expect(rpcCalls.map((call) => call.name)).toEqual([
      "payment_record_successful_payment",
      "ops_read_feature_flag",
      "gacha_process_paid_order",
    ]);
    expect(rpcCalls[1]?.args).toMatchObject({
      p_key: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
    });
    expect(result).toMatchObject({
      eventType: "successful_payment",
      paymentRecorded: true,
      paymentOrderStatus: "failed",
      processStatus: "failed",
      fulfillmentAttempted: true,
      fulfillment: {
        fulfilled: false,
        status: "failed",
        reasonCode: "DROP_POOL_EMPTY",
        paymentOrderStatus: "failed",
        retryable: true,
      },
    });
  });

  it("parses answerPreCheckoutQuery responses and rejects Telegram failures", () => {
    expect(
      parseAnswerPreCheckoutQueryResponse({
        ok: true,
        result: true,
      }),
    ).toBe(true);

    expect(() =>
      parseAnswerPreCheckoutQueryResponse({
        ok: false,
        description: "Bad Request: query is too old",
      }),
    ).toThrow(TelegramStarsWebhookError);
  });

  it("creates an invoice link, stores the invoice, and keeps the payment order created", async () => {
    const { client, state } = createSupabaseClientMock();
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            result: INVOICE_LINK,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
    );

    const result = await createTelegramStarsInvoice({
      starOrderId: STAR_ORDER_ID,
      drawOrderId: ORDER_ID,
      userId: USER_ID,
      invoicePayload: PAYLOAD,
      xtrAmount: 90,
      requestId: "req_test_invoice",
      client,
      fetchImpl: fetchMock,
      env: {
        TELEGRAM_BOT_TOKEN: "local-test-telegram-bot-token",
        TELEGRAM_STARS_CURRENCY: "XTR",
      } as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      starOrderId: STAR_ORDER_ID,
      payload: PAYLOAD,
      invoiceLink: INVOICE_LINK,
      openMode: "web_app_open_invoice",
      paymentOrderStatus: "created",
      reused: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.rpcCalls.map((call) => call.name)).toEqual([
      "payment_get_star_order_for_invoice",
      "payment_get_star_invoice_by_payload",
      "payment_upsert_star_invoice_success",
      "payment_mark_order_invoice_created",
    ]);
    expect(state.rpcCalls[2]?.args).toMatchObject({
      p_star_order_id: STAR_ORDER_ID,
      p_invoice_link: INVOICE_LINK,
      p_payload: PAYLOAD,
      p_open_mode: "web_app_open_invoice",
      p_raw_request: expect.objectContaining({
        provider_token_configured: false,
        currency: "XTR",
      }),
    });
    expect(state.rpcCalls[3]?.args).toMatchObject({
      p_star_order_id: STAR_ORDER_ID,
      p_draw_order_id: ORDER_ID,
      p_invoice_payload: PAYLOAD,
    });
  });

  it("reuses an existing invoice for an idempotent repeat without calling Telegram again", async () => {
    const { client } = createSupabaseClientMock({
      existingInvoice: {
        star_order_id: STAR_ORDER_ID,
        invoice_link: INVOICE_LINK,
        payload: PAYLOAD,
        status: "created",
        open_mode: "web_app_open_invoice",
        bot_api_method: "createInvoiceLink",
        expires_at: EXPIRES_AT,
      },
    });
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, result: INVOICE_LINK })),
    );

    const result = await createTelegramStarsInvoice({
      starOrderId: STAR_ORDER_ID,
      drawOrderId: ORDER_ID,
      userId: USER_ID,
      invoicePayload: PAYLOAD,
      xtrAmount: 90,
      requestId: "req_test_invoice_repeat",
      client,
      fetchImpl: fetchMock,
      env: {
        TELEGRAM_BOT_TOKEN: "local-test-telegram-bot-token",
        TELEGRAM_STARS_CURRENCY: "XTR",
      } as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      invoiceLink: INVOICE_LINK,
      reused: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createSupabaseClientMock(
  options: {
    existingInvoice?: Record<string, unknown> | null;
  } = {},
): {
  client: SupabaseAdminClient;
  state: MockState;
} {
  const state: MockState = {
    rpcCalls: [],
  };
  const starOrder = {
    id: STAR_ORDER_ID,
    user_id: USER_ID,
    business_type: "gacha_open",
    business_id: ORDER_ID,
    status: "created",
    xtr_amount: 90,
    telegram_invoice_payload: PAYLOAD,
    title: "Legendary Box",
    description: "Open blind box x10",
    expires_at: EXPIRES_AT,
  };

  const client = {
    schema(schema: string) {
      return {
        rpc(name: string, args: Record<string, unknown>) {
          state.rpcCalls.push({
            schema,
            name,
            args,
          });

          if (name === "payment_get_star_order_for_invoice") {
            return Promise.resolve({
              data: starOrder,
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          }

          if (name === "payment_get_star_invoice_by_payload") {
            return Promise.resolve({
              data: options.existingInvoice ?? null,
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          }

          if (name === "payment_upsert_star_invoice_success") {
            return Promise.resolve({
              data: {
                star_order_id: args.p_star_order_id,
                invoice_link: args.p_invoice_link,
                payload: args.p_payload,
                status: "created",
                open_mode: args.p_open_mode,
                bot_api_method: "createInvoiceLink",
                expires_at: args.p_expires_at ?? null,
              },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          }

          if (name === "payment_mark_order_invoice_created") {
            return Promise.resolve({
              data: {
                star_order_id: args.p_star_order_id,
                draw_order_id: args.p_draw_order_id,
                invoice_payload: args.p_invoice_payload,
              },
              error: null,
              count: null,
              status: 200,
              statusText: "OK",
            });
          }

          return Promise.resolve({
            data: {},
            error: null,
            count: null,
            status: 200,
            statusText: "OK",
          });
        },
      };
    },
  };

  return {
    client: client as unknown as SupabaseAdminClient,
    state,
  };
}
