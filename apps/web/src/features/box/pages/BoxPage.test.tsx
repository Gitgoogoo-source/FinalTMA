import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackProvider } from "@/app/providers/FeedbackProvider";
import type { TelegramGlobal } from "@/types/telegram";

import type {
  BlindBox,
  CreateOpenOrderResponse,
  DrawResultResponse,
} from "../box.types";
import { BoxPage } from "./BoxPage";

type CreateOrderMutateOptions = {
  onSuccess?: (order: CreateOpenOrderResponse) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

const mocks = vi.hoisted(() => ({
  boxes: [] as BlindBox[],
  createOrderMutate: vi.fn(),
  createOrderResult: null as CreateOpenOrderResponse | null,
  drawResultByOrderId: new Map<string, DrawResultResponse>(),
  drawResultRefetch: vi.fn(),
  rewardsRefetch: vi.fn(),
  useDrawResult: vi.fn(),
}));

vi.mock("../hooks/useBoxes", () => ({
  useBoxes: () => ({
    boxes: mocks.boxes,
    error: null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
    serverTime: "2026-05-28T00:00:00.000Z",
  }),
}));

vi.mock("../hooks/useBoxRewards", () => ({
  useBoxRewards: () => ({
    error: null,
    generatedAt: "2026-05-28T00:00:00.000Z",
    isError: false,
    isLoading: false,
    pityRule: null,
    poolVersion: 1,
    poolVersionId: "33333333-3333-4333-8333-333333333333",
    refetch: mocks.rewardsRefetch,
    rewards: [],
  }),
}));

vi.mock("../hooks/useCreateOpenOrder", () => ({
  useCreateOpenOrder: () => ({
    isPending: false,
    mutate: mocks.createOrderMutate,
    variables: null,
  }),
}));

vi.mock("../hooks/useDrawResult", () => ({
  useDrawResult: mocks.useDrawResult,
}));

describe("BoxPage Stars invoice flow", () => {
  beforeEach(() => {
    mocks.boxes = [createBox()];
    mocks.createOrderResult = createOrder();
    mocks.drawResultByOrderId.clear();
    mocks.drawResultRefetch.mockReset();
    mocks.createOrderMutate.mockReset();
    mocks.createOrderMutate.mockImplementation(
      (_input: unknown, options?: CreateOrderMutateOptions) => {
        if (!mocks.createOrderResult) {
          throw new Error("createOrderResult missing");
        }

        options?.onSuccess?.(mocks.createOrderResult);
        options?.onSettled?.();
      },
    );
    mocks.useDrawResult.mockReset();
    mocks.useDrawResult.mockImplementation(
      (orderId: string | null | undefined) => ({
        error: null,
        isError: false,
        isFetching: false,
        isLoading: false,
        refetch: mocks.drawResultRefetch,
        result: orderId
          ? (mocks.drawResultByOrderId.get(orderId) ?? null)
          : null,
      }),
    );
  });

  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
    vi.clearAllMocks();
  });

  it("opens the Telegram Stars invoice after creating an order", async () => {
    const openInvoice = vi.fn();
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(openInvoice).toHaveBeenCalledWith(
        "https://t.me/invoice/test-open-order",
        expect.any(Function),
      );
    });
    expect(screen.getByText("正在打开 Stars 支付窗口")).toBeVisible();
  });

  it("shows a retryable state when Telegram invoice opening is unavailable", async () => {
    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(
        screen.getAllByText("支付未打开，可重试支付").length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "重试支付" })).toBeVisible();
  });

  it("polls the existing draw result endpoint while the payment sheet is open", async () => {
    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "等待 Stars 支付" }),
      ).toBeVisible();
    });

    expect(
      mocks.useDrawResult.mock.calls.some(([orderId, options]) => {
        return (
          orderId === mocks.createOrderResult?.orderId &&
          options &&
          typeof options === "object" &&
          "enabled" in options &&
          options.enabled === true
        );
      }),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "查看结果状态" }));

    expect(mocks.drawResultRefetch).toHaveBeenCalledTimes(1);
  });

  it("opens the result modal only after result polling is completed", async () => {
    const order = createOrder();
    mocks.createOrderResult = order;
    mocks.drawResultByOrderId.set(order.orderId, createDrawResult(order));

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "测试盲盒奖励" }),
      ).toBeVisible();
    });
    expect(
      screen.queryByRole("dialog", { name: "等待 Stars 支付" }),
    ).not.toBeInTheDocument();
  });
});

function renderBoxPage() {
  return render(
    <FeedbackProvider>
      <BoxPage />
    </FeedbackProvider>,
  );
}

function createBox(overrides: Partial<BlindBox> = {}): BlindBox {
  return {
    coverImageUrl: null,
    description: "测试盲盒",
    disabledReason: null,
    discountBps: 1000,
    discountRate: 0.9,
    heroImageUrl: null,
    id: "11111111-1111-4111-8111-111111111111",
    isOpenable: true,
    kcoinReturnPerDraw: 100,
    name: "测试盲盒",
    pityProgress: null,
    remainingStock: 100,
    singleStarPrice: 10,
    slug: "test-box",
    sortOrder: 1,
    status: "active",
    stockStatus: "available",
    tenDrawPrice: 90,
    tier: "normal",
    totalStock: 1000,
    updatedAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

function createOrder(
  overrides: Partial<CreateOpenOrderResponse> = {},
): CreateOpenOrderResponse {
  return {
    devPaymentProcessed: false,
    drawCount: 1,
    expiresAt: "2026-05-28T00:15:00.000Z",
    idempotent: false,
    invoiceLink: "https://t.me/invoice/test-open-order",
    invoiceOpenMode: "web_app_open_invoice",
    invoicePayload: "invoice-payload",
    orderId: "22222222-2222-4222-8222-222222222222",
    orderStatus: "created",
    paymentOrderStatus: "invoice_created",
    paymentStatus: "invoice_created",
    resultReady: false,
    starOrderId: "44444444-4444-4444-8444-444444444444",
    xtrAmount: 10,
    ...overrides,
  };
}

function createDrawResult(order: CreateOpenOrderResponse): DrawResultResponse {
  return {
    balances: {
      fgems: null,
      kcoin: "100",
      stars: null,
    },
    boxName: "测试盲盒奖励",
    completedAt: "2026-05-28T00:02:00.000Z",
    invoicePayload: order.invoicePayload,
    orderId: order.orderId,
    orderStatus: "completed",
    paidAt: "2026-05-28T00:01:00.000Z",
    paidStars: order.xtrAmount,
    paymentStatus: "fulfilled",
    quantity: order.drawCount,
    results: [
      {
        description: null,
        drawIndex: 1,
        formId: null,
        formIndex: null,
        formName: null,
        imageUrl: null,
        isPityHit: false,
        itemInstanceId: "55555555-5555-4555-8555-555555555555",
        itemType: "character",
        level: 1,
        name: "测试藏品",
        power: 10,
        rarity: "rare",
        rarityLabel: "稀有",
        rewardSource: "random",
        serialNumber: 1,
        subtitle: null,
        templateId: "66666666-6666-4666-8666-666666666666",
        templateSlug: "test-item",
        thumbnailUrl: null,
      },
    ],
    returnedKcoin: 100,
    serverTime: "2026-05-28T00:02:00.000Z",
    status: "completed",
  };
}
