import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackProvider } from "@/app/providers/FeedbackProvider";
import type { TelegramGlobal } from "@/types/telegram";

import type {
  BlindBox,
  CreateOpenOrderResponse,
  DrawResultResponse,
} from "../box.types";
import { PENDING_STARS_PAYMENT_STORAGE_KEY } from "../hooks/useStarsPayment";
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
  paymentStatusByOrderId: new Map<string, DrawResultResponse>(),
  paymentStatusRefetch: vi.fn(),
  rewardsRefetch: vi.fn(),
  useDrawResult: vi.fn(),
  usePaymentStatus: vi.fn(),
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

vi.mock("@/features/banners/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [],
    error: null,
    isError: false,
    isLoading: false,
    primaryBanner: null,
    refetch: vi.fn(),
    serverTime: null,
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

vi.mock("../hooks/usePaymentStatus", () => ({
  usePaymentStatus: mocks.usePaymentStatus,
}));

describe("BoxPage Stars invoice flow", () => {
  beforeEach(() => {
    mocks.boxes = [createBox()];
    mocks.createOrderResult = createOrder();
    mocks.drawResultByOrderId.clear();
    mocks.paymentStatusByOrderId.clear();
    mocks.drawResultRefetch.mockReset();
    mocks.paymentStatusRefetch.mockReset();
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
    mocks.usePaymentStatus.mockReset();
    mocks.usePaymentStatus.mockImplementation(
      (orderId: string | null | undefined) => ({
        error: null,
        isError: false,
        isFetching: false,
        isLoading: false,
        refetch: mocks.paymentStatusRefetch,
        result: orderId
          ? (mocks.paymentStatusByOrderId.get(orderId) ?? null)
          : null,
      }),
    );
    globalThis.localStorage?.removeItem(PENDING_STARS_PAYMENT_STORAGE_KEY);
  });

  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
    globalThis.localStorage?.removeItem(PENDING_STARS_PAYMENT_STORAGE_KEY);
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
    expect(screen.getByText("支付窗口已打开")).toBeVisible();
  });

  it("refreshes possible rewards when the sheet opens", async () => {
    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /查看全部/ }));

    await waitFor(() => {
      expect(mocks.rewardsRefetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("dialog", { name: "测试盲盒" })).toBeVisible();
  });

  it("keeps open buttons locked while an order is waiting for payment", async () => {
    const openInvoice = vi.fn();
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    const openOnceButton = screen.getByRole("button", { name: /^开 1 次/ });
    fireEvent.click(openOnceButton);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "等待 Stars 支付" }),
      ).toBeVisible();
    });

    expect(openOnceButton).toBeDisabled();
    expect(screen.getByRole("button", { name: /^开 10 次/ })).toBeDisabled();

    fireEvent.click(openOnceButton);

    expect(mocks.createOrderMutate).toHaveBeenCalledTimes(1);
  });

  it("does not reopen invoice when paymentOrderStatus is already server-controlled", async () => {
    const openInvoice = vi.fn();
    mocks.createOrderResult = createOrder({
      orderStatus: "invoice_created",
      paymentOrderStatus: "paid",
      paymentStatus: "invoice_created",
    });
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "支付已成功，等待发货" }),
      ).toBeVisible();
    });

    expect(openInvoice).not.toHaveBeenCalled();
  });

  it("keeps a paid invoice callback pending until the server confirms fulfillment", async () => {
    const openInvoice = vi.fn(
      (_url: string, callback?: (status: string) => void) => {
        callback?.("paid");
      },
    );
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(screen.getByText("支付已返回，等待服务端确认")).toBeVisible();
    });
    expect(
      screen.getByRole("dialog", { name: "等待 Stars 支付" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "测试盲盒奖励" }),
    ).not.toBeInTheDocument();
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

  it("shows expired orders from the server without offering payment retry", async () => {
    const openInvoice = vi.fn();
    const order = createOrder();
    mocks.createOrderResult = order;
    mocks.paymentStatusByOrderId.set(
      order.orderId,
      createDrawResult(order, {
        completedAt: null,
        orderStatus: "expired",
        paymentOrderStatus: "expired",
        paymentStatus: "expired",
        results: [],
        status: "pending",
      }),
    );
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "订单已过期" })).toBeVisible();
    });
    expect(
      screen.queryByRole("button", { name: "重试支付" }),
    ).not.toBeInTheDocument();
    expect(
      globalThis.localStorage?.getItem(PENDING_STARS_PAYMENT_STORAGE_KEY),
    ).toBeNull();
  });

  it("polls the payment status query while the payment sheet is open", async () => {
    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "等待 Stars 支付" }),
      ).toBeVisible();
    });

    expect(
      mocks.usePaymentStatus.mock.calls.some(([orderId, options]) => {
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

    expect(mocks.paymentStatusRefetch).toHaveBeenCalledTimes(1);
  });

  it("locks rapid repeated single-draw clicks until the create request settles", () => {
    mocks.createOrderMutate.mockImplementation(() => undefined);

    renderBoxPage();

    const openOnceButton = screen.getByRole("button", { name: /^开 1 次/ });
    fireEvent.click(openOnceButton);
    fireEvent.click(openOnceButton);

    expect(mocks.createOrderMutate).toHaveBeenCalledTimes(1);
  });

  it("shows not_started boxes but keeps payment actions disabled", () => {
    mocks.boxes = [
      createBox({
        disabledReason: "活动未开始",
        isOpenable: false,
        status: "not_started",
      }),
    ];

    renderBoxPage();

    expect(screen.getAllByText("未开始 · 活动未开始").length).toBeGreaterThan(
      0,
    );

    const openOnceButton = screen.getByRole("button", { name: /^开 1 次/ });
    expect(openOnceButton).toBeDisabled();

    fireEvent.click(openOnceButton);

    expect(mocks.createOrderMutate).not.toHaveBeenCalled();
  });

  it("uses the displayed ten-draw price as the expected order price and shows the returned amount", async () => {
    const openInvoice = vi.fn();
    mocks.createOrderResult = createOrder({
      drawCount: 10,
      xtrAmount: 90,
    });
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    fireEvent.click(
      screen.getByRole("button", { name: "开 10 次，90 Stars，9 折" }),
    );

    expect(mocks.createOrderMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        drawCount: 10,
        expectedPriceStars: 90,
      }),
      expect.any(Object),
    );
    await waitFor(() => {
      expect(screen.getByText("90 Stars · 10 次")).toBeVisible();
    });
  });

  it("opens the result modal only after result polling is completed", async () => {
    const order = createOrder();
    mocks.createOrderResult = order;
    mocks.drawResultByOrderId.set(order.orderId, createDrawResult(order));
    mocks.paymentStatusByOrderId.set(order.orderId, createDrawResult(order));

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

  it("does not keep retry payment available after polling sees fulfillment", async () => {
    const order = createOrder();
    mocks.createOrderResult = order;
    mocks.paymentStatusByOrderId.set(
      order.orderId,
      createDrawResult(order, {
        completedAt: null,
        orderStatus: "processing",
        paymentOrderStatus: "fulfilling",
        paymentStatus: "fulfilling",
        results: [],
        status: "pending",
      }),
    );

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "发货处理中" })).toBeVisible();
    });
    expect(
      screen.queryByRole("button", { name: "重试支付" }),
    ).not.toBeInTheDocument();
  });

  it("restores a pending order from local storage and checks server status", async () => {
    const openInvoice = vi.fn();
    const order = createOrder({
      expiresAt: "2099-05-28T00:15:00.000Z",
    });
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };
    globalThis.localStorage?.setItem(
      PENDING_STARS_PAYMENT_STORAGE_KEY,
      JSON.stringify({
        expiresAt: order.expiresAt,
        orderId: order.orderId,
        savedAt: "2026-05-28T00:01:00.000Z",
      }),
    );
    mocks.paymentStatusByOrderId.set(
      order.orderId,
      createDrawResult(order, {
        completedAt: null,
        orderStatus: "invoice_created",
        paymentOrderStatus: "invoice_created",
        paymentStatus: "invoice_created",
        results: [],
        status: "pending",
      }),
    );

    renderBoxPage();

    await waitFor(() => {
      expect(
        screen.getByText("已恢复上次未完成订单，正在向服务端确认支付状态。"),
      ).toBeVisible();
    });
    expect(
      screen.getByRole("dialog", { name: "等待 Stars 支付" }),
    ).toBeVisible();
    expect(openInvoice).not.toHaveBeenCalled();
    expect(
      mocks.usePaymentStatus.mock.calls.some(([orderId, options]) => {
        return (
          orderId === order.orderId &&
          options &&
          typeof options === "object" &&
          "enabled" in options &&
          options.enabled === true
        );
      }),
    ).toBe(true);
  });
});

function renderBoxPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <BoxPage />
      </FeedbackProvider>
    </QueryClientProvider>,
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

function createDrawResult(
  order: CreateOpenOrderResponse,
  overrides: Partial<DrawResultResponse> = {},
): DrawResultResponse {
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
    paymentOrderStatus: "fulfilled",
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
    ...overrides,
  };
}
