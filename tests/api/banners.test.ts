import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

describe("user banner API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    callRpcRawMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only active banners for a valid placement and filters time windows", async () => {
    const now = Date.now();
    callRpcRawMock.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        code: "market-live",
        title: "Market Live",
        description: "visible",
        image_url: "https://cdn.example.test/market-live.png",
        placement: "market_top",
        target_type: "external",
        target_ref: "https://example.test/live",
        target_payload: { url: "https://example.test/live" },
        status: "active",
        sort_order: 1,
        starts_at: new Date(now - 60_000).toISOString(),
        ends_at: new Date(now + 60_000).toISOString(),
        metadata: {},
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        code: "market-future",
        title: "Market Future",
        description: null,
        image_url: "https://cdn.example.test/market-future.png",
        placement: "market_top",
        target_type: "none",
        target_ref: null,
        target_payload: {},
        status: "active",
        sort_order: 2,
        starts_at: new Date(now + 60_000).toISOString(),
        ends_at: null,
        metadata: {},
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
    ]);

    const { default: bannersHandler } = await import("../../api/banners/list");
    const result = await invokeApiHandler<ApiSuccessResponse>(bannersHandler, {
      method: "GET",
      url: "/api/banners/list?placement=market_top",
      query: {
        placement: "market_top",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        placement: "market_top",
        items: [
          {
            code: "market-live",
            targetHref: "https://example.test/live",
          },
        ],
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "catalog_list_banner_campaigns",
      {
        p_placement: "market_top",
        p_limit: 20,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          placement: "market_top",
          limit: 5,
        }),
      }),
    );
  });

  it("builds hrefs for all guide banner target types", async () => {
    const now = Date.now();
    callRpcRawMock.mockResolvedValueOnce([
      createBannerRow({
        code: "box-target",
        target_type: "box",
        target_ref: "11111111-1111-4111-8111-111111111111",
        target_payload: {},
        sort_order: 1,
        now,
      }),
      createBannerRow({
        code: "listing-target",
        target_type: "listing",
        target_ref: "22222222-2222-4222-8222-222222222222",
        target_payload: {},
        sort_order: 2,
        now,
      }),
      createBannerRow({
        code: "task-target",
        target_type: "task",
        target_ref: "daily_check_in",
        target_payload: {},
        sort_order: 3,
        now,
      }),
      createBannerRow({
        code: "payment-target",
        target_type: "payment",
        target_ref: null,
        target_payload: {
          star_order_id: "33333333-3333-4333-8333-333333333333",
        },
        sort_order: 4,
        now,
      }),
      createBannerRow({
        code: "external-target",
        target_type: "external",
        target_ref: "https://example.test/event",
        target_payload: {},
        sort_order: 5,
        now,
      }),
      createBannerRow({
        code: "none-target",
        target_type: "none",
        target_ref: null,
        target_payload: {},
        sort_order: 6,
        now,
      }),
    ]);

    const { default: bannersHandler } = await import("../../api/banners/list");
    const result = await invokeApiHandler<ApiSuccessResponse>(bannersHandler, {
      method: "GET",
      url: "/api/banners/list?placement=market_top&limit=10",
      query: {
        placement: "market_top",
        limit: "10",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        items: [
          {
            code: "box-target",
            targetType: "box",
            targetHref: "/box?boxId=11111111-1111-4111-8111-111111111111",
          },
          {
            code: "listing-target",
            targetType: "listing",
            targetHref:
              "/trade?tab=buy&listingId=22222222-2222-4222-8222-222222222222",
          },
          {
            code: "task-target",
            targetType: "task",
            targetHref: "/tasks?task=daily_check_in",
          },
          {
            code: "payment-target",
            targetType: "payment",
            targetHref:
              "/box?paymentOrderId=33333333-3333-4333-8333-333333333333",
          },
          {
            code: "external-target",
            targetType: "external",
            targetHref: "https://example.test/event",
          },
          {
            code: "none-target",
            targetType: "none",
            targetHref: null,
          },
        ],
      },
    });
  });

  it("rejects unknown placements before querying Supabase", async () => {
    const { default: bannersHandler } = await import("../../api/banners/list");
    const result = await invokeApiHandler(bannersHandler, {
      method: "GET",
      url: "/api/banners/list?placement=home",
      query: {
        placement: "home",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

function createBannerRow(input: {
  code: string;
  target_type: string;
  target_ref: string | null;
  target_payload: Record<string, unknown>;
  sort_order: number;
  now: number;
}): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-${String(input.sort_order).padStart(12, "0")}`,
    code: input.code,
    title: input.code,
    description: null,
    image_url: `https://cdn.example.test/${input.code}.png`,
    placement: "market_top",
    target_type: input.target_type,
    target_ref: input.target_ref,
    target_payload: input.target_payload,
    status: "active",
    sort_order: input.sort_order,
    starts_at: new Date(input.now - 60_000).toISOString(),
    ends_at: new Date(input.now + 60_000).toISOString(),
    metadata: {},
    created_at: new Date(input.now).toISOString(),
    updated_at: new Date(input.now).toISOString(),
  };
}
