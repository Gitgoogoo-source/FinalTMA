import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/api/errors";
import { FeedbackProvider } from "@/app/providers/FeedbackProvider";
import type { TelegramGlobal } from "@/types/telegram";

import type { CreateOpenOrderResponse, DrawResultResponse } from "../box.types";
import {
  BOX_PITY_CACHE_STORAGE_KEY,
  type CachedBoxPitySnapshot,
} from "../box.pityCache";
import { PENDING_STARS_PAYMENT_STORAGE_KEY } from "../hooks/useStarsPayment";
import { BoxPage } from "./BoxPage";

type CreateOrderMutateOptions = {
  onSuccess?: (order: CreateOpenOrderResponse) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

type CreateClaimMutateOptions = {
  onSuccess?: (claim: ClaimVipDailyResult) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

type CreateFreeBoxClaimMutateOptions = {
  onSuccess?: (claim: ClaimVipFreeBoxResult) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

type ClaimVipDailyResult = {
  claimId: string;
  fgemsAmount: number;
  fgemsClaimed: boolean;
  fgemsClaimedAt: string | null;
  freeBoxAvailable: boolean;
  freeBoxClaimed: boolean;
  freeBoxClaimedAt: string | null;
  freeBoxCount: number;
  freeBoxUsedCount: number;
  remainingFreeBoxCount: number;
};

type ClaimVipFreeBoxResult = {
  claimId: string;
  freeBoxAvailable: boolean;
  freeBoxClaimed: boolean;
  freeBoxClaimedAt: string | null;
  freeBoxCount: number;
  freeBoxUsedCount: number;
  fgemsClaimed: boolean;
  remainingFreeBoxCount: number;
};

type VipStatusMock = {
  isVip: boolean;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  todayClaimed: boolean;
  today: {
    businessDateUtc: string | null;
    claimId: string | null;
    claimed: boolean;
    canClaim: boolean;
    fgemsAmount: number;
    fgemsClaimed: boolean;
    fgemsClaimedAt: string | null;
    canClaimFgems: boolean;
    freeBoxCount: number;
    freeBoxUsedCount: number;
    remainingFreeBoxCount: number;
    freeBoxAvailable: boolean;
    freeBoxClaimed: boolean;
    freeBoxClaimedAt: string | null;
    canClaimFreeBox: boolean;
  } | null;
  plan: {
    dailyFgems: number;
    dailyFreeBoxCount: number;
  } | null;
  serverTime: string | null;
};

type VipTodayMock = NonNullable<VipStatusMock["today"]>;

type CreateVipStatusOverrides = Omit<Partial<VipStatusMock>, "today"> & {
  today?: Partial<VipTodayMock> | null;
};

const mocks = vi.hoisted(() => ({
  assetsKcoinAvailable: "1000",
  createOrderMutate: vi.fn(),
  createOrderResult: null as CreateOpenOrderResponse | null,
  claimVipDailyMutate: vi.fn(),
  claimVipDailyResult: null as ClaimVipDailyResult | null,
  claimVipFreeBoxMutate: vi.fn(),
  claimVipFreeBoxResult: null as ClaimVipFreeBoxResult | null,
  drawResultByOrderId: new Map<string, DrawResultResponse>(),
  openVipDailyMutate: vi.fn(),
  openVipDailyResult: null as CreateOpenOrderResponse | null,
  openKcoinTopupSheet: vi.fn(),
  drawResultRefetch: vi.fn(),
  paymentStatusByOrderId: new Map<string, DrawResultResponse>(),
  paymentStatusRefetch: vi.fn(),
  pitySnapshot: null as CachedBoxPitySnapshot | null,
  refreshBoxPity: vi.fn(),
  refreshAssets: vi.fn(),
  useDrawResult: vi.fn(),
  usePaymentStatus: vi.fn(),
  vipStatus: null as VipStatusMock | null,
}));

vi.mock("@/features/assets/hooks/useMyAssets", () => ({
  useMyAssets: () => ({
    assets: {
      fgems: { available: "0", currencyCode: "FGEMS", locked: "0" },
      kcoin: {
        available: mocks.assetsKcoinAvailable,
        currencyCode: "KCOIN",
        locked: "0",
      },
      stars: { available: "0", currencyCode: "STAR_DISPLAY", locked: "0" },
    },
    error: null,
    isError: false,
    isLoading: false,
    refreshAssets: mocks.refreshAssets,
    serverTime: "2026-05-28T00:00:00.000Z",
  }),
}));

vi.mock("@/features/assets/components/KcoinTopupProvider", () => ({
  useKcoinTopupSheet: () => ({
    openKcoinTopupSheet: mocks.openKcoinTopupSheet,
  }),
}));

vi.mock("../hooks/useCachedBoxPity", () => ({
  useCachedBoxPity: () => ({
    error: null,
    hasUsableCache: mocks.pitySnapshot !== null,
    isInitialSyncing: false,
    isSyncing: false,
    refresh: mocks.refreshBoxPity,
    snapshot: mocks.pitySnapshot,
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

vi.mock("../hooks/useCreateOpenOrder", () => ({
  useCreateOpenOrder: () => ({
    isPending: false,
    mutate: mocks.createOrderMutate,
    variables: null,
  }),
}));

vi.mock("../hooks/useOpenVipDailyBox", () => ({
  useOpenVipDailyBox: () => ({
    isPending: false,
    mutate: mocks.openVipDailyMutate,
    variables: null,
  }),
}));

vi.mock("@/features/vip/hooks/useClaimVipDailyBenefit", () => ({
  useClaimVipDailyBenefit: () => ({
    isPending: false,
    mutate: mocks.claimVipDailyMutate,
    variables: null,
  }),
}));

vi.mock("@/features/vip/hooks/useClaimVipFreeBox", () => ({
  useClaimVipFreeBox: () => ({
    isPending: false,
    mutate: mocks.claimVipFreeBoxMutate,
    variables: null,
  }),
}));

vi.mock("@/features/vip/hooks/useVipStatus", () => ({
  useVipStatus: () => ({
    data: mocks.vipStatus,
    isError: false,
    isLoading: false,
  }),
}));

vi.mock("../hooks/useDrawResult", () => ({
  useDrawResult: mocks.useDrawResult,
}));

vi.mock("../hooks/usePaymentStatus", () => ({
  usePaymentStatus: mocks.usePaymentStatus,
}));

describe("BoxPage K-coin open and recharge flow", () => {
  beforeEach(() => {
    mocks.assetsKcoinAvailable = "1000";
    mocks.pitySnapshot = createPitySnapshot();
    mocks.createOrderResult = createOrder();
    mocks.openVipDailyResult = createOrder({
      devPaymentProcessed: false,
      drawCount: 1,
      expiresAt: null,
      invoiceLink: null,
      invoiceOpenMode: null,
      invoicePayload: null,
      orderId: "99999999-9999-4999-8999-999999999999",
      orderStatus: "completed",
      paidKcoin: 0,
      paymentOrderStatus: "fulfilled",
      paymentStatus: "fulfilled",
      resultReady: true,
      starOrderId: null,
      totalPriceKcoin: 0,
      xtrAmount: 0,
    });
    mocks.claimVipDailyResult = {
      claimId: "88888888-8888-4888-8888-888888888888",
      fgemsAmount: 100,
      fgemsClaimed: true,
      fgemsClaimedAt: "2026-05-28T00:05:00.000Z",
      freeBoxAvailable: false,
      freeBoxClaimed: false,
      freeBoxClaimedAt: null,
      freeBoxCount: 1,
      freeBoxUsedCount: 0,
      remainingFreeBoxCount: 0,
    };
    mocks.claimVipFreeBoxResult = {
      claimId: "99999999-9999-4999-8999-999999999998",
      freeBoxAvailable: true,
      freeBoxClaimed: true,
      freeBoxClaimedAt: "2026-05-28T00:06:00.000Z",
      freeBoxCount: 1,
      freeBoxUsedCount: 0,
      fgemsClaimed: false,
      remainingFreeBoxCount: 1,
    };
    mocks.vipStatus = createVipStatus({
      isVip: false,
      today: null,
    });
    mocks.drawResultByOrderId.clear();
    mocks.paymentStatusByOrderId.clear();
    mocks.openKcoinTopupSheet.mockReset();
    mocks.drawResultRefetch.mockReset();
    mocks.paymentStatusRefetch.mockReset();
    mocks.refreshBoxPity.mockReset();
    mocks.refreshBoxPity.mockResolvedValue(mocks.pitySnapshot);
    mocks.refreshAssets.mockReset();
    mocks.refreshAssets.mockResolvedValue(undefined);
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
    mocks.claimVipDailyMutate.mockReset();
    mocks.claimVipDailyMutate.mockImplementation(
      (_input: unknown, options?: CreateClaimMutateOptions) => {
        if (!mocks.claimVipDailyResult) {
          throw new Error("claimVipDailyResult missing");
        }

        options?.onSuccess?.(mocks.claimVipDailyResult);
        options?.onSettled?.();
      },
    );
    mocks.claimVipFreeBoxMutate.mockReset();
    mocks.claimVipFreeBoxMutate.mockImplementation(
      (_input: unknown, options?: CreateFreeBoxClaimMutateOptions) => {
        if (!mocks.claimVipFreeBoxResult) {
          throw new Error("claimVipFreeBoxResult missing");
        }

        options?.onSuccess?.(mocks.claimVipFreeBoxResult);
        options?.onSettled?.();
      },
    );
    mocks.openVipDailyMutate.mockReset();
    mocks.openVipDailyMutate.mockImplementation(
      (_input: unknown, options?: CreateOrderMutateOptions) => {
        if (!mocks.openVipDailyResult) {
          throw new Error("openVipDailyResult missing");
        }

        options?.onSuccess?.(mocks.openVipDailyResult);
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
    globalThis.localStorage?.removeItem(BOX_PITY_CACHE_STORAGE_KEY);
  });

  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
    globalThis.localStorage?.removeItem(PENDING_STARS_PAYMENT_STORAGE_KEY);
    globalThis.localStorage?.removeItem(BOX_PITY_CACHE_STORAGE_KEY);
    vi.clearAllMocks();
  });

  it("opens a box with K-coin without creating a Telegram Stars invoice", async () => {
    const openInvoice = vi.fn();
    const order = createOrder();
    mocks.createOrderResult = order;
    mocks.drawResultByOrderId.set(order.orderId, createDrawResult(order));
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "测试盲盒奖励" }),
      ).toBeVisible();
    });
    expect(openInvoice).not.toHaveBeenCalled();
  });

  it("opens the shared K-coin topup sheet instead of creating an open order when balance is low", async () => {
    mocks.assetsKcoinAvailable = "0";

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    expect(mocks.createOrderMutate).not.toHaveBeenCalled();
    expect(mocks.openKcoinTopupSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        boxSlug: "starter_egg",
        drawCount: 1,
        intent: "OPEN_BOX",
        requiredAmount: 10,
        onFulfilled: expect.any(Function),
      }),
    );
  });

  it("uses backend shortage details when the open order API reports low balance", async () => {
    mocks.assetsKcoinAvailable = "1000";
    mocks.createOrderMutate.mockImplementationOnce(
      (_input: unknown, options?: CreateOrderMutateOptions) => {
        options?.onError?.(
          new ApiClientError({
            code: "INSUFFICIENT_KCOIN",
            message: "K-coin 余额不足，请先充值。",
            status: 402,
            details: {
              required: 10,
              balance: 1,
              shortage: 9,
              canTopup: true,
              fixedTopupPackages: [500, 1000, 5000, 10000],
            },
          }),
        );
        options?.onSettled?.();
      },
    );

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    await waitFor(() => {
      expect(mocks.openKcoinTopupSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          boxSlug: "starter_egg",
          currentBalance: 1,
          drawCount: 1,
          intent: "OPEN_BOX",
          requiredAmount: 10,
          onFulfilled: expect.any(Function),
        }),
      );
    });
  });

  it("retries the original open request after the shortage topup is fulfilled", async () => {
    mocks.assetsKcoinAvailable = "1";

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    const topupOptions = mocks.openKcoinTopupSheet.mock.calls[0]?.[0] as {
      onFulfilled?: () => void | Promise<void>;
    };

    expect(mocks.createOrderMutate).not.toHaveBeenCalled();
    await act(async () => {
      await topupOptions.onFulfilled?.();
    });

    await waitFor(() => {
      expect(mocks.createOrderMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          boxSlug: "starter_egg",
          drawCount: 1,
        }),
        expect.any(Object),
      );
    });
  });

  it("opens hardcoded possible rewards without refreshing the server", async () => {
    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /查看全部/ }));

    expect(screen.getByRole("dialog", { name: "Normal Egg" })).toBeVisible();
    expect(screen.getByText("Forest Sproutling")).toBeVisible();
  });

  it("uses the configured launch box images for the three box tiers", () => {
    renderBoxPage();

    expect(screen.getByRole("img", { name: "Normal Egg" })).toHaveAttribute(
      "src",
      "/images/boxes/starter_egg.png",
    );

    fireEvent.click(screen.getByRole("button", { name: /Rare Egg/ }));
    expect(screen.getByRole("img", { name: "Rare Egg" })).toHaveAttribute(
      "src",
      "/images/boxes/premium_egg.png",
    );

    fireEvent.click(screen.getByRole("button", { name: /Legendary Egg/ }));
    expect(screen.getByRole("img", { name: "Legendary Egg" })).toHaveAttribute(
      "src",
      "/images/boxes/legendary_egg.png",
    );
  });

  it("does not render the custom hero back button", () => {
    renderBoxPage();

    expect(
      screen.queryByRole("button", { name: "返回上一页" }),
    ).not.toBeInTheDocument();
  });

  it("hides the VIP daily benefit entry for non-VIP users", () => {
    renderBoxPage();

    expect(screen.queryByLabelText("月卡每日福利")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /领取 100 FGEMS/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps open buttons locked while an order is waiting for payment", async () => {
    const openInvoice = vi.fn();
    mocks.createOrderResult = createLegacyStarsOrder();
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
    mocks.createOrderResult = createLegacyStarsOrder({
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
    mocks.createOrderResult = createLegacyStarsOrder();
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
    mocks.createOrderResult = createLegacyStarsOrder();

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
    const order = createLegacyStarsOrder();
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
    mocks.createOrderResult = createLegacyStarsOrder();

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

  it("keeps payment actions available while pity cache is syncing", () => {
    mocks.pitySnapshot = null;

    renderBoxPage();

    expect(screen.getByRole("button", { name: /Normal Egg/ })).toBeVisible();

    const openOnceButton = screen.getByRole("button", { name: /^开 1 次/ });
    expect(openOnceButton).toBeEnabled();

    fireEvent.click(openOnceButton);

    expect(mocks.createOrderMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        boxSlug: "starter_egg",
        drawCount: 1,
      }),
      expect.any(Object),
    );
  });

  it("uses the selected static box slug when creating an order", () => {
    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /^开 1 次/ }));

    const input = mocks.createOrderMutate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(mocks.createOrderMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        boxSlug: "starter_egg",
        drawCount: 1,
      }),
      expect.any(Object),
    );
    expect(input).not.toHaveProperty("boxId");
    expect(input).not.toHaveProperty("expectedPriceStars");
    expect(input).not.toHaveProperty("expectedPoolVersionId");
  });

  it("claims only the VIP daily FGEMS benefit from the FGEMS button", async () => {
    mocks.vipStatus = createVipStatus({
      isVip: true,
      today: {
        claimed: false,
        canClaim: true,
        fgemsClaimed: false,
        canClaimFgems: true,
        freeBoxAvailable: false,
        freeBoxClaimed: false,
        canClaimFreeBox: true,
        freeBoxCount: 1,
        freeBoxUsedCount: 0,
      },
    });

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /领取 100 FGEMS/ }));

    expect(mocks.claimVipDailyMutate).toHaveBeenCalledTimes(1);
    expect(mocks.claimVipFreeBoxMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Normal Egg" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^开 1 次/ })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "开 1 次，免费" }),
    ).not.toBeInTheDocument();
  });

  it("claims the VIP free box separately and switches the free egg open to free", async () => {
    mocks.vipStatus = createVipStatus({
      isVip: true,
      today: {
        claimed: true,
        canClaim: false,
        fgemsClaimed: true,
        canClaimFgems: false,
        freeBoxAvailable: false,
        freeBoxClaimed: false,
        canClaimFreeBox: true,
        freeBoxCount: 1,
        freeBoxUsedCount: 0,
      },
    });

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /领取免费盲盒/ }));

    expect(mocks.claimVipFreeBoxMutate).toHaveBeenCalledTimes(1);
    expect(mocks.claimVipDailyMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Rare Egg" })).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "开 1 次，免费" })).toBeEnabled();
  });

  it("uses the VIP free premium egg RPC instead of creating a Stars order", async () => {
    mocks.vipStatus = createVipStatus({
      isVip: true,
      today: {
        claimed: true,
        canClaim: false,
        fgemsClaimed: true,
        canClaimFgems: false,
        freeBoxAvailable: true,
        freeBoxClaimed: true,
        canClaimFreeBox: false,
        freeBoxCount: 1,
        freeBoxUsedCount: 0,
      },
    });

    renderBoxPage();

    fireEvent.click(screen.getByRole("button", { name: /使用免费盲盒/ }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "开 1 次，免费" }),
      ).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "开 1 次，免费" }));

    expect(mocks.openVipDailyMutate).toHaveBeenCalledTimes(1);
    expect(mocks.createOrderMutate).not.toHaveBeenCalled();
  });

  it("submits only the selected slug and ten-draw action while showing the returned amount", async () => {
    const openInvoice = vi.fn();
    mocks.createOrderResult = createOrder({
      drawCount: 10,
      paidKcoin: 90,
      totalPriceKcoin: 90,
    });
    mocks.drawResultByOrderId.set(
      mocks.createOrderResult.orderId,
      createDrawResult(mocks.createOrderResult),
    );
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openInvoice,
      },
    };

    renderBoxPage();

    fireEvent.click(
      screen.getByRole("button", { name: "开 10 次，90 K-coin，9 折" }),
    );

    expect(mocks.createOrderMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        boxSlug: "starter_egg",
        drawCount: 10,
      }),
      expect.any(Object),
    );
    expect(mocks.createOrderMutate.mock.calls[0]?.[0]).not.toHaveProperty(
      "expectedPriceStars",
    );
    expect(mocks.createOrderMutate.mock.calls[0]?.[0]).not.toHaveProperty(
      "expectedPoolVersionId",
    );
    await waitFor(() => {
      expect(screen.getByText("90 K-coin")).toBeVisible();
    });
    expect(openInvoice).not.toHaveBeenCalled();
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
    const order = createLegacyStarsOrder();
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
    const order = createLegacyStarsOrder({
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

function createPitySnapshot(): CachedBoxPitySnapshot {
  return {
    items: [
      {
        boxId: "11111111-1111-4111-8111-111111111111",
        pityProgress: createPityProgress({
          currentCount: 3,
          remainingToGuaranteed: 27,
          ruleId: "aaaa1111-1111-4111-8111-111111111111",
          targetRarity: "rare",
          threshold: 30,
        }),
        slug: "starter_egg",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      {
        boxId: "22222222-2222-4222-8222-222222222222",
        pityProgress: createPityProgress({
          currentCount: 8,
          remainingToGuaranteed: 42,
          ruleId: "bbbb2222-2222-4222-8222-222222222222",
          targetRarity: "epic",
          threshold: 50,
        }),
        slug: "premium_egg",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      {
        boxId: "33333333-3333-4333-8333-333333333333",
        pityProgress: createPityProgress({
          currentCount: 12,
          remainingToGuaranteed: 68,
          ruleId: "cccc3333-3333-4333-8333-333333333333",
          targetRarity: "legendary",
          threshold: 80,
        }),
        slug: "legendary_egg",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    ],
    serverTime: "2026-05-28T00:00:00.000Z",
    syncedAt: "2026-05-28T00:00:00.000Z",
    version: 1,
  };
}

function createPityProgress(input: {
  currentCount: number;
  remainingToGuaranteed: number;
  ruleId: string;
  targetRarity: string;
  threshold: number;
}) {
  return {
    currentCount: input.currentCount,
    guaranteedNext: input.remainingToGuaranteed <= 0,
    remainingToGuaranteed: input.remainingToGuaranteed,
    ruleId: input.ruleId,
    targetRarity: input.targetRarity,
    threshold: input.threshold,
    totalDraws: input.currentCount,
    updatedAt: "2026-05-28T00:00:00.000Z",
  };
}

function createVipStatus(
  overrides: CreateVipStatusOverrides = {},
): VipStatusMock {
  const { today: todayOverride, ...statusOverrides } = overrides;
  const today =
    todayOverride === null
      ? null
      : {
          businessDateUtc: "2026-05-28",
          claimId: null,
          claimed: false,
          canClaim: false,
          fgemsAmount: 100,
          fgemsClaimed: false,
          fgemsClaimedAt: null,
          canClaimFgems: false,
          freeBoxCount: 0,
          freeBoxUsedCount: 0,
          remainingFreeBoxCount: 0,
          freeBoxAvailable: false,
          freeBoxClaimed: false,
          freeBoxClaimedAt: null,
          canClaimFreeBox: false,
          ...todayOverride,
        };

  return {
    currentPeriodEnd: statusOverrides.isVip ? "2026-06-28T00:00:00.000Z" : null,
    isVip: false,
    plan: {
      dailyFgems: 100,
      dailyFreeBoxCount: 1,
    },
    serverTime: "2026-05-28T00:00:00.000Z",
    subscriptionId: statusOverrides.isVip
      ? "77777777-7777-4777-8777-777777777777"
      : null,
    ...statusOverrides,
    today,
    todayClaimed: statusOverrides.todayClaimed ?? today?.claimed ?? false,
  };
}

function createOrder(
  overrides: Partial<CreateOpenOrderResponse> = {},
): CreateOpenOrderResponse {
  return {
    devPaymentProcessed: false,
    drawCount: 1,
    expiresAt: null,
    idempotent: false,
    invoiceLink: null,
    invoiceOpenMode: null,
    invoicePayload: null,
    orderId: "22222222-2222-4222-8222-222222222222",
    orderStatus: "completed",
    paidKcoin: 10,
    paymentOrderStatus: "fulfilled",
    paymentStatus: "fulfilled",
    resultReady: true,
    starOrderId: null,
    totalPriceKcoin: 10,
    xtrAmount: 0,
    ...overrides,
  };
}

function createLegacyStarsOrder(
  overrides: Partial<CreateOpenOrderResponse> = {},
): CreateOpenOrderResponse {
  return createOrder({
    expiresAt: "2026-05-28T00:15:00.000Z",
    invoiceLink: "https://t.me/invoice/test-open-order",
    invoiceOpenMode: "web_app_open_invoice",
    invoicePayload: "invoice-payload",
    orderStatus: "created",
    paidKcoin: 0,
    paymentOrderStatus: "invoice_created",
    paymentStatus: "invoice_created",
    resultReady: false,
    starOrderId: "44444444-4444-4444-8444-444444444444",
    totalPriceKcoin: 0,
    xtrAmount: 10,
    ...overrides,
  });
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
    paidKcoin: order.paidKcoin,
    paidStars: order.xtrAmount,
    paymentProvider: order.starOrderId ? "telegram_stars" : "kcoin",
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
