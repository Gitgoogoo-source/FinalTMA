import { describe, expect, it, vi } from "vitest";

import type { SupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin";
import {
  buildAnswerPreCheckoutQueryRequest,
  buildTelegramStarsInvoiceRequest,
  createTelegramStarsInvoice,
  parseAnswerPreCheckoutQueryResponse,
  parseCreateInvoiceLinkResponse,
  parseTelegramPreCheckoutUpdate,
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
  upserts: Array<{
    schema: string;
    table: string;
    values: Record<string, unknown>;
  }>;
  updates: Array<{
    schema: string;
    table: string;
    values: Record<string, unknown>;
    column: string;
    value: string;
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

  it("creates an invoice link, stores the invoice, and marks the order invoice-created", async () => {
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
      paymentOrderStatus: "invoice_created",
      reused: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.upserts[0]?.values).toMatchObject({
      star_order_id: STAR_ORDER_ID,
      invoice_link: INVOICE_LINK,
      payload: PAYLOAD,
      status: "created",
      bot_api_method: "createInvoiceLink",
    });
    expect(state.upserts[0]?.values.raw_request).toMatchObject({
      provider_token_configured: false,
      currency: "XTR",
    });
    expect(state.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "payments",
          table: "star_orders",
          values: expect.objectContaining({
            status: "invoice_created",
          }),
        }),
        expect.objectContaining({
          schema: "gacha",
          table: "draw_orders",
          values: expect.objectContaining({
            status: "invoice_created",
            payment_status: "pending",
            telegram_invoice_payload: PAYLOAD,
          }),
        }),
      ]),
    );
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
    upserts: [],
    updates: [],
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
        from(table: string) {
          return {
            select(_columns: string) {
              return {
                eq(_column: string, _value: string) {
                  return {
                    async maybeSingle() {
                      if (schema === "payments" && table === "star_orders") {
                        return {
                          data: starOrder,
                          error: null,
                        };
                      }

                      if (schema === "payments" && table === "star_invoices") {
                        return {
                          data: options.existingInvoice ?? null,
                          error: null,
                        };
                      }

                      return {
                        data: null,
                        error: null,
                      };
                    },
                  };
                },
              };
            },
            update(values: Record<string, unknown>) {
              return {
                async eq(column: string, value: string) {
                  state.updates.push({
                    schema,
                    table,
                    values,
                    column,
                    value,
                  });

                  return {
                    error: null,
                  };
                },
              };
            },
            upsert(values: Record<string, unknown>) {
              state.upserts.push({
                schema,
                table,
                values,
              });

              return {
                select(_columns: string) {
                  return {
                    async single() {
                      return {
                        data: {
                          star_order_id: values.star_order_id,
                          invoice_link: values.invoice_link ?? null,
                          payload: values.payload,
                          status: values.status,
                          open_mode: values.open_mode,
                          bot_api_method: values.bot_api_method,
                          expires_at: values.expires_at ?? null,
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    client: client as unknown as SupabaseAdminClient,
    state,
  };
}
