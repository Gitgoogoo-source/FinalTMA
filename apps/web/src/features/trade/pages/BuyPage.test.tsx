import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BuyPage } from "./BuyPage";

const mocks = vi.hoisted(() => ({
  buyMutate: vi.fn(),
  createVipOrder: vi.fn(),
  marketRefetch: vi.fn(),
  openVipStarsInvoice: vi.fn(),
  pushToast: vi.fn(),
  resetFilters: vi.fn(),
  updateFilter: vi.fn(),
  vipRefetch: vi.fn(),
  vipStatus: null as VipStatusMock | null,
}));

type VipStatusMock = {
  isVip: boolean;
  currentPeriodEnd: string | null;
  plan: {
    id: string;
    code: string | null;
    displayName: string;
    priceXtr: number;
    durationDays: number | null;
    dailyFgems: number;
    dailyFreeBoxCount: number;
    feeRebateBps: number;
  } | null;
};

vi.mock("@/app/providers/FeedbackProvider", () => ({
  useFeedback: () => ({
    clearFeedback: vi.fn(),
    closeRewardModal: vi.fn(),
    dismissToast: vi.fn(),
    pushToast: mocks.pushToast,
    rewardModal: {
      open: false,
      title: "",
      rewards: [],
      confirmLabel: "知道了",
    },
    showRewardModal: vi.fn(),
    toasts: [],
  }),
}));

vi.mock("@/features/assets/hooks/useMyAssets", () => ({
  useMyAssets: () => ({
    assets: {
      kcoin: {
        available: "1000",
      },
    },
  }),
}));

vi.mock("@/features/vip/hooks/useVipStatus", () => ({
  useVipStatus: () => ({
    data: mocks.vipStatus,
    isLoading: false,
    refetch: mocks.vipRefetch,
  }),
}));

vi.mock("@/features/vip/hooks/useCreateVipOrder", () => ({
  useCreateVipOrder: () => ({
    isPending: false,
    mutateAsync: mocks.createVipOrder,
  }),
}));

vi.mock("@/features/vip/hooks/useVipStarsPayment", () => ({
  useVipStarsPayment: () => mocks.openVipStarsInvoice,
}));

vi.mock("../hooks/useBuyListing", () => ({
  useBuyListing: () => ({
    isPending: false,
    mutate: mocks.buyMutate,
  }),
}));

vi.mock("../hooks/useMarketFilters", () => ({
  useMarketFilters: () => ({
    filters: {
      maxPriceKcoin: "",
      minPriceKcoin: "",
      rarity: "",
      sort: "recently_listed",
      typeCode: "",
    },
    hasActiveFilters: false,
    query: {},
    resetFilters: mocks.resetFilters,
    updateFilter: mocks.updateFilter,
  }),
}));

vi.mock("../hooks/useMarketListings", () => ({
  useMarketListings: () => ({
    isError: false,
    isLoading: false,
    listings: [
      {
        canBuy: true,
        createdAt: null,
        currencyCode: "KCOIN",
        expiresAt: null,
        formId: null,
        imageUrl: null,
        isOwnListing: false,
        itemCount: 1,
        itemName: "测试藏品",
        listingId: "listing-1",
        notBuyableReason: null,
        priceHealth: "healthy",
        rarityCode: "rare",
        rarityLabel: "Rare",
        remainingCount: 1,
        sellerDisplayName: "玩家",
        sellerUserId: "seller-1",
        serialNo: 7,
        status: "active",
        templateId: "template-1",
        typeCode: "character",
        unitPriceKcoin: 120,
      },
    ],
    refetch: mocks.marketRefetch,
  }),
}));

vi.mock("../components/MarketListingGrid", () => ({
  isVisibleBuyListing: () => true,
  MarketListingGrid: () => <div data-testid="market-listing-grid" />,
}));

vi.mock("../components/MarketFilters", () => ({
  MarketFilters: () => <div data-testid="market-filters" />,
}));

vi.mock("../components/ListingDetailSheet", () => ({
  ListingDetailSheet: () => <div data-testid="listing-detail-sheet" />,
}));

vi.mock("../components/BuyConfirmDialog", () => ({
  BuyConfirmDialog: () => <div data-testid="buy-confirm-dialog" />,
}));

describe("BuyPage VIP subscription banner", () => {
  beforeEach(() => {
    mocks.buyMutate.mockReset();
    mocks.createVipOrder.mockReset();
    mocks.marketRefetch.mockReset();
    mocks.openVipStarsInvoice.mockReset();
    mocks.pushToast.mockReset();
    mocks.resetFilters.mockReset();
    mocks.updateFilter.mockReset();
    mocks.vipRefetch.mockReset();
    mocks.vipStatus = createVipStatus();
    mocks.createVipOrder.mockResolvedValue(createVipOrderResponse());
    mocks.openVipStarsInvoice.mockReturnValue({
      ok: true,
      status: "opening",
    });
  });

  it("replaces the old market banner with VIP subscription entry", () => {
    render(<BuyPage />);

    expect(screen.getByRole("button", { name: "订阅 VIP 月卡" })).toBeVisible();
    expect(screen.queryByText("精选藏品交易")).not.toBeInTheDocument();
  });

  it("uses VIP status plan to create an order and open invoice", async () => {
    render(<BuyPage />);

    fireEvent.click(screen.getByRole("button", { name: "订阅 VIP 月卡" }));

    await waitFor(() => {
      expect(mocks.createVipOrder).toHaveBeenCalledWith({
        expectedPriceXtr: 199,
        planId: "plan-1",
      });
    });
    expect(mocks.openVipStarsInvoice).toHaveBeenCalledWith(
      createVipOrderResponse(),
      expect.any(Function),
    );
    expect(mocks.pushToast).toHaveBeenCalledWith({
      type: "info",
      title: "月卡订单已创建",
      message: "请在 Telegram 支付窗口完成 199 Stars 支付。",
    });
  });

  it("refetches VIP status before creating order when no plan is cached", async () => {
    mocks.vipStatus = {
      ...createVipStatus(),
      plan: null,
    };
    mocks.vipRefetch.mockResolvedValue({
      data: createVipStatus(),
    });

    render(<BuyPage />);

    fireEvent.click(screen.getByRole("button", { name: "订阅 VIP 月卡" }));

    await waitFor(() => {
      expect(mocks.vipRefetch).toHaveBeenCalledOnce();
    });
    expect(mocks.createVipOrder).toHaveBeenCalledWith({
      expectedPriceXtr: 199,
      planId: "plan-1",
    });
  });
});

function createVipStatus(): VipStatusMock {
  return {
    currentPeriodEnd: null,
    isVip: false,
    plan: {
      code: "vip_monthly",
      dailyFgems: 100,
      dailyFreeBoxCount: 1,
      displayName: "VIP 月卡",
      durationDays: 30,
      feeRebateBps: 2000,
      id: "plan-1",
      priceXtr: 199,
    },
  };
}

function createVipOrderResponse() {
  return {
    expiresAt: "2026-06-05T00:15:00.000Z",
    fulfilledAt: null,
    idempotent: false,
    invoiceLink: "https://t.me/invoice/vip-test",
    invoiceOpenMode: "web_app_open_invoice",
    invoicePayload: "vip:payload",
    orderId: "vip-order-1",
    orderStatus: "invoice_created",
    paidAt: null,
    paymentOrderStatus: "invoice_created",
    paymentStatus: "invoice_created",
    starOrderId: "star-order-1",
    xtrAmount: 199,
  };
}
