import "@testing-library/jest-dom/vitest";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackProvider } from "@/app/providers/FeedbackProvider";

import type {
  CollectionDecomposeItemResponse,
  CollectionEvolveItemResponse,
  CollectionInventoryDetail,
  CollectionInventoryItem,
  CollectionUpgradeItemResponse,
} from "../collection.types";
import { CollectionPage } from "./CollectionPage";

const mocks = vi.hoisted(() => ({
  inventoryItems: [] as unknown[],
  itemDetails: new Map<string, unknown>(),
  hasNextInventoryPage: false,
  isFetchingNextInventoryPage: false,
  inventoryRefetch: vi.fn(),
  inventoryFetchNextPage: vi.fn(),
  detailCalls: [] as Array<{
    enabled: boolean;
    itemInstanceId: string | null | undefined;
  }>,
  detailRefetch: vi.fn(),
  upgradeMutateAsync: vi.fn(),
  evolveMutateAsync: vi.fn(),
  decomposeMutateAsync: vi.fn(),
  sellMutate: vi.fn(),
  cancelSellMutate: vi.fn(),
  createMintMutate: vi.fn(),
  mintQueueRefetch: vi.fn(),
  walletStatus: null as unknown,
}));

vi.mock("../hooks/useInventory", () => ({
  useInventory: () => ({
    error: null,
    isError: false,
    isFetching: false,
    isFetchingNextPage: mocks.isFetchingNextInventoryPage,
    isLoading: false,
    hasNextPage: mocks.hasNextInventoryPage,
    items: mocks.inventoryItems,
    fetchNextPage: mocks.inventoryFetchNextPage,
    refetch: mocks.inventoryRefetch,
    serverTime: "2026-05-25T08:00:00.000Z",
    total: mocks.inventoryItems.length,
  }),
}));

vi.mock("../hooks/useItemDetail", () => ({
  useItemDetail: (
    itemInstanceId: string | null | undefined,
    options: { enabled?: boolean } = {},
  ) => {
    const enabled = options.enabled !== false && Boolean(itemInstanceId);
    mocks.detailCalls.push({ enabled, itemInstanceId });

    return {
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      item:
        enabled && itemInstanceId
          ? (mocks.itemDetails.get(itemInstanceId) ?? null)
          : null,
      refetch: () => mocks.detailRefetch(itemInstanceId),
    };
  },
}));

vi.mock("../hooks/useUpgradeItem", () => ({
  useUpgradeItem: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutateAsync: mocks.upgradeMutateAsync,
  }),
}));

vi.mock("../hooks/useEvolveItem", () => ({
  useEvolveItem: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutateAsync: mocks.evolveMutateAsync,
  }),
}));

vi.mock("../hooks/useDecomposeItem", () => ({
  useDecomposeItem: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutateAsync: mocks.decomposeMutateAsync,
  }),
}));

vi.mock("../hooks/useSellInventoryItem", () => ({
  useSellInventoryItem: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.sellMutate,
  }),
}));

vi.mock("../hooks/useCancelInventorySell", () => ({
  useCancelInventorySell: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.cancelSellMutate,
  }),
}));

vi.mock("@/features/trade/hooks/useMarketSellRules", () => ({
  useMarketSellRules: () => ({
    error: null,
    isError: false,
    isLoading: false,
    rules: {
      currencyCode: "KCOIN",
      feeBps: 500,
      feeType: "market_sell",
      source: "active_rule",
    },
  }),
}));

vi.mock("@/features/wallet/hooks/useWalletStatus", () => ({
  useWalletStatus: () => ({
    data: mocks.walletStatus,
    error: null,
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/features/wallet/hooks/useCreateMint", () => ({
  useCreateMint: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.createMintMutate,
  }),
}));

vi.mock("@/features/wallet/hooks/useMintQueue", () => ({
  useMintQueue: () => ({
    error: null,
    isError: false,
    isFetching: false,
    isLoading: false,
    items: [],
    mintQueue: null,
    nextCursor: null,
    refetch: mocks.mintQueueRefetch,
    serverTime: null,
  }),
}));

const ITEM_A_ID = "66666666-6666-4666-8666-666666666666";
const ITEM_B_ID = "66666666-6666-4666-8666-666666666667";
const ITEM_C_ID = "66666666-6666-4666-8666-666666666668";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const FORM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("CollectionPage stage-3 frontend states", () => {
  beforeEach(() => {
    mocks.inventoryItems = [];
    mocks.itemDetails = new Map<string, unknown>();
    mocks.hasNextInventoryPage = false;
    mocks.isFetchingNextInventoryPage = false;
    mocks.inventoryRefetch.mockReset();
    mocks.inventoryFetchNextPage.mockReset();
    mocks.detailCalls = [];
    mocks.detailRefetch.mockReset();
    mocks.upgradeMutateAsync.mockReset();
    mocks.evolveMutateAsync.mockReset();
    mocks.decomposeMutateAsync.mockReset();
    mocks.sellMutate.mockReset();
    mocks.cancelSellMutate.mockReset();
    mocks.createMintMutate.mockReset();
    mocks.mintQueueRefetch.mockReset();
    mocks.detailRefetch.mockImplementation(
      async (itemInstanceId: string | null | undefined) => {
        const detail = itemInstanceId
          ? (mocks.itemDetails.get(itemInstanceId) ?? null)
          : null;

        return {
          data: detail,
          error: detail ? null : new Error("detail not found"),
          isSuccess: Boolean(detail),
          status: detail ? "success" : "error",
        };
      },
    );
    mocks.upgradeMutateAsync.mockResolvedValue(upgradeResult());
    mocks.evolveMutateAsync.mockResolvedValue(evolveResult());
    mocks.decomposeMutateAsync.mockResolvedValue(decomposeResult());
    mocks.sellMutate.mockImplementation(
      (
        _input: unknown,
        options?: {
          onSuccess?: (result: unknown) => void;
        },
      ) => {
        options?.onSuccess?.({
          expectedNetAmountKcoin: 475,
          feeBps: 500,
          idempotent: false,
          itemCount: 1,
          listingId: "99999999-9999-4999-8999-999999999999",
          priceHealth: "healthy",
          remainingCount: 1,
          status: "active",
          unitPriceKcoin: 500,
        });
      },
    );
    mocks.cancelSellMutate.mockImplementation(
      (
        _input: unknown,
        options?: {
          onSuccess?: (result: unknown) => void;
        },
      ) => {
        options?.onSuccess?.({
          cancelledAt: "2026-05-25T08:00:00.000Z",
          listingId: "99999999-9999-4999-8999-999999999999",
          releasedItemInstanceIds: [ITEM_A_ID],
          status: "cancelled",
        });
      },
    );
    mocks.createMintMutate.mockImplementation(
      (
        _input: unknown,
        options?: {
          onSuccess?: (result: unknown) => void;
        },
      ) => {
        options?.onSuccess?.({
          accepted: true,
          idempotent: false,
          itemInstanceId: ITEM_A_ID,
          metadataUrl: "/nft-metadata/items/forest_sproutling.json",
          mintQueueId: "77777777-7777-4777-8777-777777777777",
          status: "queued",
        });
      },
    );
    mocks.walletStatus = makeWalletStatus("not_connected");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty inventory state when the user has no collection items", () => {
    renderCollectionPage();

    expect(screen.getByText("还没有藏品")).toBeVisible();
    expect(screen.getByText("开盒后获得的藏品会显示在这里。")).toBeVisible();
    expect(screen.getByRole("link", { name: "去开盒" })).toHaveAttribute(
      "href",
      "/box",
    );
  });

  it("renders the selected detail panel and switches selectedItem from the grid", () => {
    const firstItem = makeItem();
    const secondItem = makeItem({
      itemInstanceId: ITEM_B_ID,
      name: "月冕守门人",
      power: 88,
      rarity: {
        code: "legendary",
        label: "传说",
        sortOrder: 40,
      },
      form: {
        description: null,
        displayName: "高阶形态",
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        index: 3,
      },
      serialNo: 2,
      templateId: "77777777-7777-4777-8777-777777777777",
    });
    setInventoryItems(firstItem, secondItem);

    renderCollectionPage();

    expect(
      screen.queryByRole("link", { name: /图鉴/ }),
    ).not.toBeInTheDocument();
    const selectedPanel = screen.getByLabelText("当前选中藏品");
    const selectedSummary =
      within(selectedPanel).getByLabelText("藏品完整信息");
    expect(
      selectedSummary.closest(".character-detail-panel__hero"),
    ).not.toBeNull();
    const selectedActions = within(selectedPanel).getByLabelText("藏品操作");
    expect(
      selectedActions.closest(".character-detail-panel__hero"),
    ).not.toBeNull();
    expect(within(selectedSummary).getByText("稀有度")).toBeVisible();
    expect(within(selectedSummary).getByText("形态")).toBeVisible();
    expect(within(selectedSummary).getByText("等级")).toBeVisible();
    expect(within(selectedSummary).getByText("战力")).toBeVisible();
    expect(
      within(selectedSummary).queryByText("森林幼芽"),
    ).not.toBeInTheDocument();
    expect(
      within(selectedPanel).queryByLabelText("藏品角色说明"),
    ).not.toBeInTheDocument();
    expect(selectedPanel.querySelector(".item-status-badge")).toBeNull();
    expect(getEnabledDetailCallIds()).toEqual([]);
    expect(screen.queryByText("详情同步中")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "详情" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("我的藏品")).not.toBeInTheDocument();
    expect(screen.queryByText("2 件")).not.toBeInTheDocument();

    const secondThumb = screen.getByRole("button", { name: /月冕守门人/ });
    expect(secondThumb).toHaveAttribute("aria-pressed", "false");
    expect(secondThumb).toHaveAccessibleName(
      "月冕守门人，传说，等级 1，战力 88，形态 高阶形态",
    );
    expect(secondThumb).toHaveClass("character-thumb--legendary");
    expect(secondThumb.querySelector(".character-thumb__serial")).toBeNull();
    expect(
      secondThumb.querySelector(".character-thumb__rarity-dot"),
    ).not.toBeNull();
    expect(
      secondThumb.querySelectorAll(".character-thumb__form-star"),
    ).toHaveLength(0);
    expect(
      within(secondThumb).queryByText("月冕守门人"),
    ).not.toBeInTheDocument();
    expect(within(secondThumb).queryByText("传说")).not.toBeInTheDocument();
    expect(within(secondThumb).queryByText("Lv.1")).not.toBeInTheDocument();
    expect(within(secondThumb).queryByText("战力 88")).not.toBeInTheDocument();

    fireEvent.click(secondThumb);

    const nextSummary = within(
      screen.getByLabelText("当前选中藏品"),
    ).getByLabelText("藏品完整信息");
    expect(within(nextSummary).getByText("传说")).toBeVisible();
    expect(within(nextSummary).getByText("高阶形态")).toBeVisible();
    expect(within(nextSummary).getByText("88")).toBeVisible();
    expect(screen.getByRole("button", { name: /月冕守门人/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(getEnabledDetailCallIds()).toEqual([]);
    expect(screen.queryByText("详情同步中")).not.toBeInTheDocument();
  });

  it("groups duplicate character thumbs and shows the owned count", () => {
    const firstItem = makeItem();
    const duplicateItem = makeItem({
      itemInstanceId: ITEM_B_ID,
      level: 2,
      power: 20,
      serialNo: 2,
    });
    const otherItem = makeItem({
      itemInstanceId: ITEM_C_ID,
      name: "月冕守门人",
      power: 88,
      rarity: {
        code: "legendary",
        label: "传说",
        sortOrder: 40,
      },
      form: {
        description: null,
        displayName: "高阶形态",
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        index: 3,
      },
      serialNo: 3,
      templateId: "77777777-7777-4777-8777-777777777777",
      templateSlug: "moon_crown_guardian",
    });
    setInventoryItems(firstItem, duplicateItem, otherItem);

    renderCollectionPage();

    const groupedThumbs = screen.getAllByRole("button", {
      name: /森林幼芽/,
    });
    expect(groupedThumbs).toHaveLength(1);
    const groupedThumb = groupedThumbs[0]!;
    expect(groupedThumb).toHaveAccessibleName(
      "森林幼芽，普通，等级 1，战力 10，形态 基础形态，共有 2 件，已选中",
    );
    expect(
      groupedThumb.querySelector(".character-thumb__count"),
    ).toHaveTextContent("x2");

    const otherThumb = screen.getByRole("button", { name: /月冕守门人/ });
    expect(otherThumb.querySelector(".character-thumb__count")).toBeNull();

    fireEvent.click(otherThumb);

    expect(otherThumb).toHaveAttribute("aria-pressed", "true");
    const nextSummary = within(
      screen.getByLabelText("当前选中藏品"),
    ).getByLabelText("藏品完整信息");
    expect(within(nextSummary).getByText("传说")).toBeVisible();
    expect(within(nextSummary).getByText("高阶形态")).toBeVisible();
  });

  it("groups character thumbs by the visible image even when template and form differ", () => {
    const sharedImageUrl = "/storage/v1/object/public/collectibles/dragon.png";
    const firstItem = makeItem({
      name: "烈焰龙",
      thumbnailUrl: sharedImageUrl,
      templateId: TEMPLATE_ID,
      templateSlug: "inferno_crown_dragon",
    });
    const sameImageItem = makeItem({
      form: {
        description: null,
        displayName: "高阶形态",
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        index: 2,
      },
      itemInstanceId: ITEM_B_ID,
      name: "烈焰龙",
      power: 40,
      serialNo: 2,
      templateId: "77777777-7777-4777-8777-777777777777",
      templateSlug: "dragon_same_art",
      thumbnailUrl: sharedImageUrl,
    });
    const otherImageItem = makeItem({
      itemInstanceId: ITEM_C_ID,
      name: "月冕守门人",
      serialNo: 3,
      templateId: "88888888-8888-4888-8888-888888888888",
      templateSlug: "moon_crown_guardian",
      thumbnailUrl: "/storage/v1/object/public/collectibles/moon.png",
    });
    setInventoryItems(firstItem, sameImageItem, otherImageItem);

    renderCollectionPage();

    const groupedDragonThumbs = screen.getAllByRole("button", {
      name: /烈焰龙/,
    });
    expect(groupedDragonThumbs).toHaveLength(1);
    expect(
      groupedDragonThumbs[0]!.querySelector(".character-thumb__count"),
    ).toHaveTextContent("x2");
    expect(
      within(screen.getByLabelText("藏品网格")).getAllByRole("button"),
    ).toHaveLength(2);
  });

  it("loads the next inventory page when more items are available", async () => {
    mocks.hasNextInventoryPage = true;
    mocks.inventoryFetchNextPage.mockResolvedValueOnce({});
    mocks.inventoryItems = [makeItem()];

    renderCollectionPage();

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() => {
      expect(mocks.inventoryFetchNextPage).toHaveBeenCalledTimes(1);
    });
  });

  it("shows full selected-item details and enables growth actions for upgradeable duplicate items", () => {
    const firstItem = makeItem();
    const items = [
      firstItem,
      makeItem({ itemInstanceId: ITEM_B_ID, serialNo: 2 }),
      makeItem({ itemInstanceId: ITEM_C_ID, serialNo: 3 }),
    ];
    setInventoryItems(...items);
    setItemDetail(firstItem, makeDetail(firstItem));

    renderCollectionPage();

    const selectedPanel = screen.getByLabelText("当前选中藏品");
    const summary = within(selectedPanel).getByLabelText("藏品完整信息");

    expect(summary).toBeVisible();
    expect(within(summary).queryByText(/森林守护者/)).not.toBeInTheDocument();
    expect(within(summary).queryByText("森林幼芽")).not.toBeInTheDocument();
    expect(
      within(summary).queryByText("已进入你的库存"),
    ).not.toBeInTheDocument();
    expect(within(summary).queryByText("名称")).not.toBeInTheDocument();
    expect(within(summary).getByText("稀有度")).toBeVisible();
    expect(within(summary).getByText("普通")).toBeVisible();
    expect(within(summary).queryByText("系列")).not.toBeInTheDocument();
    expect(within(summary).getByText("形态")).toBeVisible();
    expect(within(summary).getByText("基础形态")).toBeVisible();
    expect(within(summary).getByText("等级")).toBeVisible();
    expect(within(summary).getByText("战力")).toBeVisible();
    expect(within(summary).queryByText("编号")).not.toBeInTheDocument();
    expect(within(summary).queryByText("状态")).not.toBeInTheDocument();
    expect(within(summary).queryByText("Mint 状态")).not.toBeInTheDocument();
    expect(within(summary).queryByText("是否挂售")).not.toBeInTheDocument();
    expect(within(summary).queryByText("是否可升级")).not.toBeInTheDocument();
    expect(within(summary).queryByText("是否可合成")).not.toBeInTheDocument();
    expect(within(summary).queryByText("是否可分解")).not.toBeInTheDocument();
    expect(within(summary).queryByText("是否可 Mint")).not.toBeInTheDocument();
    expect(
      within(selectedPanel).getByRole("button", { name: "升级" }),
    ).toBeEnabled();
    expect(
      within(selectedPanel).getByRole("button", { name: "合成" }),
    ).toBeEnabled();
    expect(
      within(selectedPanel).getByRole("button", { name: "分解" }),
    ).toBeEnabled();
    expect(
      within(selectedPanel).getByRole("button", { name: "出售" }),
    ).toBeEnabled();
  });

  it("opens the direct sell entry from item details and submits the price", async () => {
    const item = makeItem();
    setInventoryItems(item);
    setItemDetail(item, makeDetail(item));

    renderCollectionPage();
    fireEvent.click(
      within(screen.getByLabelText("当前选中藏品")).getByRole("button", {
        name: "出售",
      }),
    );

    const sellDialog = screen.getByRole("dialog", { name: "森林幼芽" });
    fireEvent.change(within(sellDialog).getByLabelText("出售单价"), {
      target: { value: "500" },
    });
    fireEvent.click(
      within(sellDialog).getByRole("button", { name: "确认出售" }),
    );

    await waitFor(() => expect(mocks.sellMutate).toHaveBeenCalledTimes(1));
    expect(mocks.sellMutate).toHaveBeenCalledWith(
      {
        itemInstanceId: ITEM_A_ID,
        unitPriceKcoin: 500,
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(await screen.findByText("上架成功")).toBeVisible();
  });

  it("opens the direct cancel entry for listed items and submits downlist", async () => {
    const listedItem = makeItem({
      status: "listed",
    });
    setInventoryItems(listedItem);
    setItemDetail(
      listedItem,
      makeDetail(listedItem, {
        marketStatus: {
          currency: "KCOIN",
          isListed: true,
          listingId: "99999999-9999-4999-8999-999999999999",
          unitPrice: 500,
        },
        status: "listed",
      }),
    );

    renderCollectionPage();
    fireEvent.click(
      within(screen.getByLabelText("当前选中藏品")).getByRole("button", {
        name: "下架",
      }),
    );

    const cancelDialog = screen.getByRole("dialog", { name: "森林幼芽" });
    fireEvent.click(
      within(cancelDialog).getByRole("button", { name: "确认下架" }),
    );

    await waitFor(() =>
      expect(mocks.cancelSellMutate).toHaveBeenCalledTimes(1),
    );
    expect(mocks.cancelSellMutate).toHaveBeenCalledWith(
      {
        itemInstanceId: ITEM_A_ID,
        listingId: null,
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(await screen.findByText("下架成功")).toBeVisible();
  });

  it("disables growth actions when the item is not upgradeable, lacks materials and is not duplicated", () => {
    const uniqueItem = makeItem({
      isDecomposable: false,
      isEvolvable: false,
      isUpgradeable: false,
    });
    setInventoryItems(uniqueItem);
    setItemDetail(
      uniqueItem,
      makeDetail(uniqueItem, {
        availableSameItemCount: 1,
        decomposePreview: {
          canDecompose: false,
          duplicateCount: 1,
          fgemsReward: null,
          itemInstanceIds: [ITEM_A_ID],
          itemStatus: "available",
          items: [],
          reason: "DECOMPOSE_REQUIRES_DUPLICATE",
          totalRewardFgems: null,
        },
        evolutionPreview: {
          availableSameItems: 1,
          canEvolve: false,
          isBalanceEnough: true,
          kcoinCost: 200,
          mainReturnItemId: null,
          reason: "EVOLVE_ITEM_COUNT_INVALID",
          requiredCount: 3,
          selectedItemIds: [ITEM_A_ID],
          successRateBps: 5000,
          targetFormId: FORM_ID,
          targetImageUrl: null,
          targetName: "森林幼芽·进化",
          targetTemplateId: TEMPLATE_ID,
          userKcoinBalance: 1200,
        },
        sameItemCount: 1,
      }),
    );

    renderCollectionPage();

    const selectedPanel = screen.getByLabelText("当前选中藏品");

    expect(
      within(selectedPanel).getByRole("button", { name: "升级" }),
    ).toBeDisabled();
    expect(
      within(selectedPanel).getByRole("button", { name: "合成" }),
    ).toBeDisabled();
    expect(
      within(selectedPanel).getByRole("button", { name: "分解" }),
    ).toBeDisabled();
  });

  it("submits Mint after wallet verification and item eligibility pass", async () => {
    mocks.walletStatus = makeWalletStatus("verified");
    const item = makeItem();
    setInventoryItems(item);
    setItemDetail(item, makeDetail(item));

    renderCollectionPage();

    const selectedPanel = screen.getByLabelText("当前选中藏品");
    const mintButton = within(selectedPanel).getByRole("button", {
      name: "Mint NFT",
    });

    expect(mintButton).toBeEnabled();

    fireEvent.click(mintButton);

    await waitFor(() =>
      expect(mocks.createMintMutate).toHaveBeenCalledWith(
        {
          itemInstanceId: ITEM_A_ID,
        },
        expect.objectContaining({
          onError: expect.any(Function),
          onSuccess: expect.any(Function),
        }),
      ),
    );
    expect(await screen.findByText("Mint 已入队")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Mint 队列" })).toBeVisible();
  });

  it("keeps Mint available when onchain status has no queue yet", () => {
    mocks.walletStatus = makeWalletStatus("verified");
    const item = makeItem();
    setInventoryItems(item);
    setItemDetail(
      item,
      makeDetail(item, {
        onchainStatus: {
          isMinted: false,
          mintStatus: "none",
        },
      }),
    );

    renderCollectionPage();

    const selectedPanel = screen.getByLabelText("当前选中藏品");

    expect(
      within(selectedPanel).getByRole("button", { name: "Mint NFT" }),
    ).toBeEnabled();
    expect(
      within(selectedPanel).queryByText("未 Mint"),
    ).not.toBeInTheDocument();
  });

  it("submits Mint when a stale blocked detail refreshes into an eligible state", async () => {
    mocks.walletStatus = makeWalletStatus("verified");
    const item = makeItem();
    setInventoryItems(item);
    setItemDetail(
      item,
      makeDetail(item, {
        marketStatus: {
          currency: "KCOIN",
          isListed: true,
          listingId: "99999999-9999-4999-8999-999999999999",
          unitPrice: 100,
        },
      }),
    );
    mocks.detailRefetch.mockResolvedValueOnce({
      data: makeDetail(item),
      error: null,
      isSuccess: true,
      status: "success",
    });

    renderCollectionPage();

    fireEvent.click(
      within(screen.getByLabelText("当前选中藏品")).getByRole("button", {
        name: "Mint NFT",
      }),
    );

    await waitFor(() =>
      expect(mocks.createMintMutate).toHaveBeenCalledWith(
        {
          itemInstanceId: ITEM_A_ID,
        },
        expect.objectContaining({
          onError: expect.any(Function),
          onSuccess: expect.any(Function),
        }),
      ),
    );
  });

  it("treats empty Mint status as not minted when the server detail is otherwise eligible", async () => {
    mocks.walletStatus = makeWalletStatus("verified");
    const item = makeItem({ nftMintStatus: null });
    setInventoryItems(item);
    setItemDetail(item, makeDetail(item, { nftMintStatus: null }));

    renderCollectionPage();

    fireEvent.click(
      within(screen.getByLabelText("当前选中藏品")).getByRole("button", {
        name: "Mint NFT",
      }),
    );

    await waitFor(() =>
      expect(mocks.createMintMutate).toHaveBeenCalledWith(
        {
          itemInstanceId: ITEM_A_ID,
        },
        expect.objectContaining({
          onError: expect.any(Function),
          onSuccess: expect.any(Function),
        }),
      ),
    );
  });

  it("disables the Mint entry when the wallet is not ready", () => {
    const cases = [
      {
        status: "not_connected",
      },
      {
        status: "connected_unverified",
      },
    ];

    for (const testCase of cases) {
      mocks.walletStatus = makeWalletStatus(testCase.status);
      const item = makeItem({
        itemInstanceId: `${ITEM_A_ID.slice(0, -1)}${cases.indexOf(testCase)}`,
      });
      mocks.inventoryItems = [];
      mocks.itemDetails = new Map<string, unknown>();
      mocks.createMintMutate.mockClear();
      setInventoryItems(item);
      setItemDetail(item, makeDetail(item));

      const { unmount } = renderCollectionPage();

      const selectedPanel = screen.getByLabelText("当前选中藏品");
      const mintButton = within(selectedPanel).getByRole("button", {
        name: "Mint NFT",
      });

      expect(mintButton).toBeDisabled();
      expect(mocks.createMintMutate).not.toHaveBeenCalled();

      unmount();
    }
  });

  it("disables the Mint entry for non-mintable, listed, locked, decomposed or minted items", () => {
    mocks.walletStatus = makeWalletStatus("verified");

    const cases: Array<{
      detailOverrides?: Partial<CollectionInventoryDetail>;
      itemOverrides?: Partial<CollectionInventoryItem>;
      name: string;
    }> = [
      {
        itemOverrides: { isMintable: false },
        name: "不可 Mint",
      },
      {
        detailOverrides: {
          marketStatus: {
            currency: "KCOIN",
            isListed: true,
            listingId: "99999999-9999-4999-8999-999999999999",
            unitPrice: 100,
          },
        },
        itemOverrides: { status: "listed" },
        name: "挂售中",
      },
      {
        detailOverrides: {
          activeLock: {
            expiresAt: null,
            lockedAt: "2026-05-25T08:00:00.000Z",
            lockId: "88888888-8888-4888-8888-888888888888",
            reason: "mint",
            sourceId: null,
            sourceType: "onchain",
          },
        },
        itemOverrides: { status: "locked" },
        name: "锁定中",
      },
      {
        itemOverrides: { status: "decomposed" },
        name: "已分解",
      },
      {
        detailOverrides: {
          onchainStatus: {
            isMinted: true,
            mintStatus: "minted",
          },
        },
        itemOverrides: { nftMintStatus: "minted" },
        name: "已 Mint",
      },
    ];

    for (const testCase of cases) {
      const item = makeItem({
        itemInstanceId: `${ITEM_A_ID.slice(0, -1)}${cases.indexOf(testCase)}`,
        ...testCase.itemOverrides,
      });
      mocks.inventoryItems = [];
      mocks.itemDetails = new Map<string, unknown>();
      mocks.createMintMutate.mockClear();
      setInventoryItems(item);
      setItemDetail(item, makeDetail(item, testCase.detailOverrides));

      const { unmount } = renderCollectionPage();

      const selectedPanel = screen.getByLabelText("当前选中藏品");
      const mintButton = within(selectedPanel).getByRole("button", {
        name: /Mint/,
      });

      expect(mintButton, testCase.name).toBeDisabled();
      expect(mocks.createMintMutate, testCase.name).not.toHaveBeenCalled();

      unmount();
    }
  });

  it("shows the retry Mint entry when the server reports a failed mint status", () => {
    mocks.walletStatus = makeWalletStatus("verified");
    const item = makeItem({
      nftMintStatus: "failed",
    });
    setInventoryItems(item);
    setItemDetail(
      item,
      makeDetail(item, {
        onchainStatus: {
          isMinted: false,
          mintStatus: "failed",
        },
      }),
    );

    renderCollectionPage();

    const selectedPanel = screen.getByLabelText("当前选中藏品");

    expect(
      within(selectedPanel).getByRole("button", { name: "重试 Mint" }),
    ).toBeEnabled();
  });

  it("submits an upgrade and shows the server result instead of local-only state", async () => {
    const item = makeItem();
    setInventoryItems(
      item,
      makeItem({ itemInstanceId: ITEM_B_ID, serialNo: 2 }),
      makeItem({ itemInstanceId: ITEM_C_ID, serialNo: 3 }),
    );
    setItemDetail(item, makeDetail(item));

    renderCollectionPage();
    fireEvent.click(
      within(screen.getByLabelText("当前选中藏品")).getByRole("button", {
        name: "升级",
      }),
    );

    expect(screen.getByText("藏品升级")).toBeVisible();
    expect(screen.getByText("需要 Fgems")).toBeVisible();
    expect(screen.getByText("当前 Fgems 余额")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "确认升级" }));

    await waitFor(() =>
      expect(mocks.upgradeMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.upgradeMutateAsync).toHaveBeenCalledWith({
      expectedFgemsCost: 20,
      expectedItemVersion: 7,
      itemInstanceId: ITEM_A_ID,
      targetLevel: 2,
    });
    expect(
      await screen.findByRole("dialog", { name: "升级成功" }),
    ).toBeVisible();
    expect(screen.getByText("消耗 Fgems")).toBeVisible();
    expect(screen.getByText("80 -> 60")).toBeVisible();
  });

  it("opens all evolve info and actions inside a liquid-glass dialog", async () => {
    const item = makeItem();
    setInventoryItems(
      item,
      makeItem({ itemInstanceId: ITEM_B_ID, serialNo: 2 }),
      makeItem({ itemInstanceId: ITEM_C_ID, serialNo: 3 }),
    );

    renderCollectionPage();
    fireEvent.click(
      within(screen.getByLabelText("当前选中藏品")).getByRole("button", {
        name: "合成",
      }),
    );

    const evolveDialog = screen.getByRole("dialog", { name: "森林幼芽" });
    expect(evolveDialog.closest(".evolve-panel--liquid-glass")).not.toBeNull();
    expect(within(evolveDialog).getByText("合成 / 进化")).toBeVisible();
    expect(within(evolveDialog).getByLabelText("目标形态")).toBeVisible();
    expect(
      within(evolveDialog).getByText("Forest Sproutling II"),
    ).toBeVisible();
    expect(within(evolveDialog).getByLabelText("合成预览")).toBeVisible();
    expect(within(evolveDialog).getByText("KCOIN 消耗")).toBeVisible();
    expect(within(evolveDialog).getByText("成功率")).toBeVisible();
    expect(within(evolveDialog).getByText("选择 3 个同款材料")).toBeVisible();
    expect(
      within(evolveDialog).getByRole("button", { name: "确认合成" }),
    ).toBeEnabled();

    fireEvent.click(
      within(evolveDialog).getByRole("button", { name: "确认合成" }),
    );

    await waitFor(() =>
      expect(mocks.evolveMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.evolveMutateAsync).toHaveBeenCalledWith({
      sourceItemInstanceIds: [ITEM_A_ID, ITEM_B_ID, ITEM_C_ID],
    });
    expect(mocks.detailCalls.some((call) => call.enabled)).toBe(false);
    expect(
      await screen.findByRole("dialog", { name: "合成成功" }),
    ).toBeVisible();
  });
});

function renderCollectionPage() {
  return render(
    <MemoryRouter>
      <FeedbackProvider>
        <CollectionPage />
      </FeedbackProvider>
    </MemoryRouter>,
  );
}

function setInventoryItems(...items: CollectionInventoryItem[]) {
  mocks.inventoryItems = items;
}

function setItemDetail(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail,
) {
  mocks.itemDetails.set(item.itemInstanceId, detail);
}

function getEnabledDetailCallIds(): Array<string | null | undefined> {
  return mocks.detailCalls
    .filter((call) => call.enabled)
    .map((call) => call.itemInstanceId);
}

function makeWalletStatus(status: string) {
  return {
    address:
      status === "not_connected"
        ? null
        : "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
    errorMessage: null,
    lastSyncAt: null,
    mintQueue: null,
    network: "testnet",
    rawAddress:
      status === "not_connected"
        ? null
        : "0:0000000000000000000000000000000000000000000000000000000000000000",
    status,
    syncStatus: "idle",
    verifiedAt: status === "verified" ? "2026-05-25T08:00:00.000Z" : null,
    walletAppName: "Tonkeeper",
  };
}

function makeItem(
  overrides: Partial<CollectionInventoryItem> = {},
): CollectionInventoryItem {
  return {
    avatarUrl: null,
    description: "已进入你的库存",
    form: {
      description: null,
      displayName: "基础形态",
      id: FORM_ID,
      index: 1,
    },
    imageUrl: null,
    isDecomposable: true,
    isEvolvable: true,
    isMintable: true,
    isTradeable: true,
    isUpgradeable: true,
    itemInstanceId: ITEM_A_ID,
    level: 1,
    name: "森林幼芽",
    nftMintStatus: "not_minted",
    obtainedAt: "2026-05-24T08:00:00.000Z",
    power: 10,
    rarity: {
      code: "common",
      label: "普通",
      sortOrder: 10,
    },
    serialNo: 1,
    series: {
      displayName: "森林守护者",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "forest_guardians",
    },
    sourceId: null,
    sourceType: "gacha",
    status: "available",
    subtitle: "测试藏品",
    templateId: TEMPLATE_ID,
    templateSlug: "forest_sproutling",
    thumbnailUrl: null,
    typeCode: "CHARACTER",
    ...overrides,
  };
}

function makeDetail(
  item: CollectionInventoryItem,
  overrides: Partial<CollectionInventoryDetail> = {},
): CollectionInventoryDetail {
  return {
    ...item,
    activeLock: null,
    attributes: {},
    availableSameItemCount: 3,
    basePower: 10,
    decomposePreview: {
      canDecompose: true,
      duplicateCount: 3,
      fgemsReward: 150,
      itemInstanceIds: [item.itemInstanceId],
      itemStatus: "available",
      items: [],
      reason: null,
      totalRewardFgems: 150,
    },
    evolutionPreview: {
      availableSameItems: 3,
      canEvolve: true,
      isBalanceEnough: true,
      kcoinCost: 200,
      mainReturnItemId: ITEM_C_ID,
      reason: null,
      requiredCount: 3,
      selectedItemIds: [ITEM_C_ID, ITEM_B_ID, item.itemInstanceId],
      successRateBps: 5000,
      targetFormId: FORM_ID,
      targetImageUrl: null,
      targetName: "森林幼芽·进化",
      targetTemplateId: TEMPLATE_ID,
      userKcoinBalance: 1200,
    },
    faction: null,
    formId: item.form?.id ?? null,
    marketStatus: {
      currency: null,
      isListed: false,
      listingId: null,
      unitPrice: null,
    },
    itemVersion: 7,
    onchainStatus: null,
    sameItemCount: 3,
    updatedAt: "2026-05-25T08:00:00.000Z",
    upgradePreview: {
      canUpgrade: true,
      currentLevel: 1,
      currentPower: 10,
      fgemsCost: 20,
      isBalanceEnough: true,
      nextLevel: 2,
      powerAfter: 18,
      reason: null,
      targetLevel: 2,
      userFgemsBalance: 80,
    },
    ...overrides,
  };
}

function upgradeResult(): CollectionUpgradeItemResponse {
  return {
    balanceChange: -20,
    consumedFgems: 20,
    costFgems: 20,
    fgemsBalanceAfter: 60,
    fgemsBalanceBefore: 80,
    fromLevel: 1,
    fromPower: 10,
    idempotent: false,
    itemInstanceId: ITEM_A_ID,
    ledgerId: "77777777-7777-4777-8777-777777777778",
    toLevel: 2,
    toPower: 18,
    upgradedAt: "2026-05-25T08:00:00.000Z",
  };
}

function evolveResult(): CollectionEvolveItemResponse {
  return {
    attemptId: "77777777-7777-4777-8777-777777777779",
    balanceChange: -200,
    consumedItemInstanceIds: [ITEM_A_ID, ITEM_B_ID, ITEM_C_ID],
    consumedKcoin: 200,
    costKcoin: 200,
    createdItemInstanceId: "66666666-6666-4666-8666-666666666669",
    evolvedAt: "2026-05-25T08:00:00.000Z",
    idempotent: false,
    kcoinBalanceAfter: 1000,
    kcoinBalanceBefore: 1200,
    ledgerId: "77777777-7777-4777-8777-777777777780",
    mainItemInstanceId: ITEM_C_ID,
    randomRollBps: 2500,
    result: "success",
    returnedItemInstanceId: null,
    sourceItemInstanceIds: [ITEM_A_ID, ITEM_B_ID, ITEM_C_ID],
    success: true,
    successRateBps: 5000,
  };
}

function decomposeResult(): CollectionDecomposeItemResponse {
  return {
    balanceChange: 150,
    decomposedAt: "2026-05-25T08:00:00.000Z",
    decomposedItemInstanceIds: [ITEM_A_ID],
    fgemsBalanceAfter: 230,
    fgemsBalanceBefore: 80,
    gainedFgems: 150,
    idempotent: false,
    items: [{ item_instance_id: ITEM_A_ID, reward_fgems: 150 }],
    ledgerId: "77777777-7777-4777-8777-777777777781",
    totalRewardFgems: 150,
  };
}
