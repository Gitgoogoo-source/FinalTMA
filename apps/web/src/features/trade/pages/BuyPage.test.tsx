import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BuyPage } from "./BuyPage";

const mocks = vi.hoisted(() => ({
  buyMutate: vi.fn(),
  createVipOrder: vi.fn(),
  kcoinAvailable: "1000",
  marketRefetch: vi.fn(),
  openKcoinTopupSheet: vi.fn(),
  pushToast: vi.fn(),
  refreshAssets: vi.fn(),
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
    priceKcoin: number;
    currencyCode: "KCOIN";
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
        available: mocks.kcoinAvailable,
      },
    },
    refreshAssets: mocks.refreshAssets,
  }),
}));

vi.mock("@/features/assets/components/KcoinTopupProvider", () => ({
  useKcoinTopupSheet: () => ({
    openKcoinTopupSheet: mocks.openKcoinTopupSheet,
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
    mocks.kcoinAvailable = "1000";
    mocks.marketRefetch.mockReset();
    mocks.openKcoinTopupSheet.mockReset();
    mocks.pushToast.mockReset();
    mocks.refreshAssets.mockReset();
    mocks.refreshAssets.mockResolvedValue(undefined);
    mocks.resetFilters.mockReset();
    mocks.updateFilter.mockReset();
    mocks.vipRefetch.mockReset();
    mocks.vipRefetch.mockResolvedValue({
      data: createVipStatus(),
    });
    mocks.vipStatus = createVipStatus();
    mocks.createVipOrder.mockResolvedValue(createVipOrderResponse());
  });

  it("replaces the old market banner with VIP subscription entry", () => {
    render(<BuyPage />);

    expect(screen.getByRole("button", { name: "订阅 VIP 月卡" })).toBeVisible();
    expect(screen.getByText(/199 K-coin/)).toBeVisible();
    expect(screen.queryByText("精选藏品交易")).not.toBeInTheDocument();
  });

  it("uses VIP status plan id to create a KCOIN order", async () => {
    render(<BuyPage />);

    fireEvent.click(screen.getByRole("button", { name: "订阅 VIP 月卡" }));

    await waitFor(() => {
      expect(mocks.createVipOrder).toHaveBeenCalledWith({
        planId: "plan-1",
      });
    });
    expect(mocks.pushToast).toHaveBeenCalledWith({
      type: "success",
      title: "月卡已开通",
      message: "已消耗 199 K-coin。",
    });
  });

  it("opens KCOIN topup sheet when local balance is not enough", async () => {
    mocks.kcoinAvailable = "1";

    render(<BuyPage />);

    fireEvent.click(screen.getByRole("button", { name: "订阅 VIP 月卡" }));

    await waitFor(() => {
      expect(mocks.openKcoinTopupSheet).toHaveBeenCalledWith(
        expect.objectContaining({
          currentBalance: 1,
          intent: "VIP_MONTHLY",
          requiredAmount: 199,
        }),
      );
    });
    expect(mocks.createVipOrder).not.toHaveBeenCalled();
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
      expect(mocks.createVipOrder).toHaveBeenCalledWith({
        planId: "plan-1",
      });
    });
    expect(mocks.vipRefetch).toHaveBeenCalledTimes(2);
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
      currencyCode: "KCOIN",
      priceKcoin: 199,
      priceXtr: 199,
    },
  };
}

function createVipOrderResponse() {
  return {
    expiresAt: "2026-06-05T00:15:00.000Z",
    fulfilledAt: null,
    idempotent: false,
    invoiceLink: null,
    invoiceOpenMode: null,
    invoicePayload: null,
    kcoinAmount: 199,
    currencyCode: "KCOIN",
    subscriptionId: "subscription-1",
    currentPeriodStart: "2026-06-05T00:00:00.000Z",
    currentPeriodEnd: "2026-07-05T00:00:00.000Z",
    kcoinLedgerId: "ledger-1",
    orderId: "vip-order-1",
    orderStatus: "fulfilled",
    paidAt: null,
    paymentOrderStatus: "fulfilled",
    paymentStatus: "fulfilled",
    starOrderId: null,
    xtrAmount: 0,
  };
}
