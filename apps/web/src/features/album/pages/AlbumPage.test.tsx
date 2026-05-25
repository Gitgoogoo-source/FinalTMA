import "@testing-library/jest-dom/vitest";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackProvider } from "@/app/providers/FeedbackProvider";

import type {
  AlbumBook,
  AlbumClaimRewardResponse,
  AlbumLeaderboardEntry,
  AlbumLeaderboardResponse,
  AlbumProgress,
  AlbumProgressQuery,
} from "../album.types";
import { AlbumPage } from "./AlbumPage";

const mocks = vi.hoisted(() => ({
  state: {
    claimed: false,
    emptyConfig: false,
    emptyLeaderboard: false,
    progressQueries: [] as unknown[],
  },
  claimMutateAsync: vi.fn(),
  progressRefetch: vi.fn(),
  seriesRefetch: vi.fn(),
  leaderboardRefetch: vi.fn(),
}));

vi.mock("../hooks/useAlbumSeries", () => ({
  useAlbumSeries: () => {
    const books = mocks.state.emptyConfig
      ? []
      : [bookAllPayload(), bookForestPayload(), bookLegendaryPayload()];

    return {
      books,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      nextCursor: null,
      refetch: mocks.seriesRefetch,
      serverTime: "2026-05-25T08:00:00.000Z",
      total: books.length,
    };
  },
}));

vi.mock("../hooks/useAlbumProgress", () => ({
  useAlbumProgress: (query: AlbumProgressQuery) => {
    mocks.state.progressQueries.push(query);

    return {
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      progress: albumProgressPayload(query?.bookId ?? null),
      refetch: mocks.progressRefetch,
    };
  },
}));

vi.mock("../hooks/useLeaderboard", () => ({
  useLeaderboard: () => ({
    entries: albumLeaderboardPayload().entries,
    error: null,
    generatedAt: albumLeaderboardPayload().generatedAt,
    isError: false,
    isFetching: false,
    isLoading: false,
    leaderboard: albumLeaderboardPayload(),
    myEntry: albumLeaderboardPayload().myEntry,
    nextCursor: null,
    refetch: mocks.leaderboardRefetch,
  }),
}));

vi.mock("../hooks/useClaimAlbumReward", () => ({
  useClaimAlbumReward: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutateAsync: mocks.claimMutateAsync,
    variables: null,
  }),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOOK_ALL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOK_FOREST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOOK_LEGENDARY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MILESTONE_ALL_FIRST_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const MILESTONE_ALL_FULL_ID = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee";
const MILESTONE_FOREST_ID = "ffffffff-ffff-4fff-ffff-ffffffffffff";

describe("AlbumPage stage-3 frontend states", () => {
  beforeEach(() => {
    mocks.state.claimed = false;
    mocks.state.emptyConfig = false;
    mocks.state.emptyLeaderboard = false;
    mocks.state.progressQueries = [];
    mocks.claimMutateAsync.mockReset();
    mocks.progressRefetch.mockReset();
    mocks.seriesRefetch.mockReset();
    mocks.leaderboardRefetch.mockReset();
    mocks.claimMutateAsync.mockImplementation(async () => {
      mocks.state.claimed = true;
      return claimRewardPayload();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty states when album configuration and leaderboard entries are absent", () => {
    mocks.state.emptyConfig = true;
    mocks.state.emptyLeaderboard = true;

    renderAlbumPage();

    expect(screen.getByTestId("album-page")).toBeVisible();
    expect(screen.getByText("暂无图鉴册")).toBeVisible();
    expect(screen.getByText("图鉴配置生成中")).toBeVisible();
    expect(
      screen.getByText("当前没有可展示的图鉴册，稍后刷新后再查看。"),
    ).toBeVisible();
    expect(screen.getByText("暂无里程碑奖励")).toBeVisible();
    expect(screen.getByText("暂无图鉴物品")).toBeVisible();
    expect(screen.getByText("榜单生成中")).toBeVisible();
  });

  it("renders progress, switches books and keeps collected versus locked item states", () => {
    renderAlbumPage();

    const progressPanel = screen.getByLabelText("图鉴收集进度");
    const allTab = screen.getByRole("button", { name: /全图鉴/ });

    expect(screen.getByRole("heading", { name: "全图鉴" })).toBeVisible();
    expect(progressPanel).toHaveTextContent("已收集1");
    expect(progressPanel).toHaveTextContent("总数量3");
    expect(progressPanel).toHaveTextContent("完成度33.33%");
    expect(allTab).toHaveAttribute("aria-current", "true");

    const collectedCard = screen.getByLabelText("月冕守门人，传说，已点亮");
    const lockedCard = screen.getByLabelText("史诗藏品，未点亮");

    expect(collectedCard).toHaveAttribute("data-collected", "true");
    expect(lockedCard).toHaveAttribute("data-collected", "false");
    expect(within(lockedCard).getByText("未知藏品")).toBeVisible();
    expect(screen.getByRole("button", { name: "领取" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "未解锁" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /森林守护者/ }));

    expect(lastProgressQuery()).toMatchObject({ bookId: BOOK_FOREST_ID });
    expect(screen.getByRole("heading", { name: "森林守护者" })).toBeVisible();
    expect(screen.getByText("森林长老")).toBeVisible();
    expect(screen.queryByText("月冕守门人")).not.toBeInTheDocument();
  });

  it("claims a milestone reward and renders the claimed state after refreshed progress", async () => {
    const view = renderAlbumPage();

    fireEvent.click(screen.getByRole("button", { name: "领取" }));

    await waitFor(() =>
      expect(mocks.claimMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.claimMutateAsync).toHaveBeenCalledWith({
      bookId: BOOK_ALL_ID,
      expectedMilestoneVersion: 0,
      milestoneId: MILESTONE_ALL_FIRST_ID,
    });
    const rewardDialog = await screen.findByRole("dialog", {
      name: "图鉴奖励已领取",
    });

    expect(rewardDialog).toBeVisible();
    expect(within(rewardDialog).getByText("100 FGEMS")).toBeVisible();
    expect(within(rewardDialog).getByText("+100")).toBeVisible();

    view.rerender(
      <FeedbackProvider>
        <AlbumPage />
      </FeedbackProvider>,
    );

    expect(screen.getByRole("button", { name: "已领取" })).toBeDisabled();
    expect(screen.getByLabelText("全图鉴初阶奖励，已领取")).toHaveAttribute(
      "data-status",
      "claimed",
    );
  });
});

function renderAlbumPage() {
  return render(
    <FeedbackProvider>
      <AlbumPage />
    </FeedbackProvider>,
  );
}

function lastProgressQuery(): unknown {
  return mocks.state.progressQueries.at(-1);
}

function albumProgressPayload(bookId: string | null): AlbumProgress {
  if (mocks.state.emptyConfig) {
    return {
      book: null,
      empty: true,
      items: [],
      milestones: [],
      raritySummary: [],
      seriesSummary: [],
      serverTime: "2026-05-25T08:00:00.000Z",
    };
  }

  if (bookId === BOOK_FOREST_ID) {
    return {
      book: bookForestPayload(),
      empty: false,
      items: [forestSproutItem({ collectedCount: 2 }), forestElderItem()],
      milestones: [
        {
          bookId: BOOK_FOREST_ID,
          claimedAt: null,
          milestoneId: MILESTONE_FOREST_ID,
          requiredCount: 2,
          requiredPercent: 100,
          rewards: [
            {
              amount: 200,
              iconUrl: null,
              label: "200 KCOIN",
              rewardType: "KCOIN",
              templateId: null,
            },
          ],
          status: "claimable",
          title: "森林守护者奖励",
          version: 0,
        },
      ],
      raritySummary: [
        {
          collectedCount: 2,
          rarity: "common",
          totalCount: 2,
        },
      ],
      seriesSummary: [
        {
          collectedCount: 2,
          seriesId: "12121212-1212-4212-8212-121212121212",
          seriesName: "森林守护者",
          totalCount: 2,
        },
      ],
      serverTime: "2026-05-25T08:00:00.000Z",
    };
  }

  return {
    book: bookAllPayload(),
    empty: false,
    items: [forestSproutItem(), moonGuardianItem(), starEchoItem()],
    milestones: [
      {
        bookId: BOOK_ALL_ID,
        claimedAt: mocks.state.claimed ? "2026-05-25T08:00:00.000Z" : null,
        milestoneId: MILESTONE_ALL_FIRST_ID,
        requiredCount: 1,
        requiredPercent: 33.33,
        rewards: [
          {
            amount: 100,
            iconUrl: null,
            label: "100 FGEMS",
            rewardType: "FGEMS",
            templateId: null,
          },
        ],
        status: mocks.state.claimed ? "claimed" : "claimable",
        title: "全图鉴初阶奖励",
        version: 0,
      },
      {
        bookId: BOOK_ALL_ID,
        claimedAt: null,
        milestoneId: MILESTONE_ALL_FULL_ID,
        requiredCount: 3,
        requiredPercent: 100,
        rewards: [
          {
            amount: 300,
            iconUrl: null,
            label: "300 KCOIN",
            rewardType: "KCOIN",
            templateId: null,
          },
        ],
        status: "locked",
        title: "全图鉴完整奖励",
        version: 0,
      },
    ],
    raritySummary: [
      {
        collectedCount: 1,
        rarity: "common",
        totalCount: 1,
      },
      {
        collectedCount: 0,
        rarity: "legendary",
        totalCount: 1,
      },
    ],
    seriesSummary: [
      {
        collectedCount: 1,
        seriesId: "12121212-1212-4212-8212-121212121212",
        seriesName: "森林守护者",
        totalCount: 2,
      },
      {
        collectedCount: 0,
        seriesId: "23232323-2323-4232-8232-232323232323",
        seriesName: "月冕卫队",
        totalCount: 1,
      },
    ],
    serverTime: "2026-05-25T08:00:00.000Z",
  };
}

function albumLeaderboardPayload(): AlbumLeaderboardResponse {
  if (mocks.state.emptyLeaderboard) {
    return {
      boardId: null,
      empty: true,
      entries: [],
      generatedAt: null,
      myEntry: null,
      nextCursor: null,
      period: "current_week",
      scope: "global",
    };
  }

  const entry: AlbumLeaderboardEntry = {
    avatarUrl: null,
    collectedCount: 1,
    completionPercent: 33.33,
    displayName: "测试玩家",
    epicCount: 0,
    legendaryCount: 0,
    mintCount: 0,
    rank: 1,
    rareCount: 0,
    score: mocks.state.claimed ? 180 : 80,
    totalCount: 3,
    updatedAt: "2026-05-25T08:00:00.000Z",
    userId: USER_ID,
  };

  return {
    boardId: "abababab-abab-4aba-8aba-abababababab",
    empty: false,
    entries: [entry],
    generatedAt: "2026-05-25T08:00:00.000Z",
    myEntry: entry,
    nextCursor: null,
    period: "current_week",
    scope: "global",
  };
}

function bookAllPayload(): AlbumBook {
  return {
    bookId: BOOK_ALL_ID,
    bookType: "all",
    code: "all",
    collectedCount: mocks.state.claimed ? 2 : 1,
    completionPercent: mocks.state.claimed ? 66.67 : 33.33,
    coverUrl: null,
    description: "全部藏品图鉴",
    endsAt: null,
    isEventLimited: false,
    name: "全图鉴",
    startsAt: null,
    totalCount: 3,
  };
}

function bookForestPayload(): AlbumBook {
  return {
    bookId: BOOK_FOREST_ID,
    bookType: "series",
    code: "series_forest_guardians",
    collectedCount: 2,
    completionPercent: 100,
    coverUrl: null,
    description: "森林守护者系列",
    endsAt: null,
    isEventLimited: false,
    name: "森林守护者",
    startsAt: null,
    totalCount: 2,
  };
}

function bookLegendaryPayload(): AlbumBook {
  return {
    bookId: BOOK_LEGENDARY_ID,
    bookType: "rarity",
    code: "rarity_legendary",
    collectedCount: 0,
    completionPercent: 0,
    coverUrl: null,
    description: "传说稀有度图鉴",
    endsAt: null,
    isEventLimited: false,
    name: "传说图鉴",
    startsAt: null,
    totalCount: 1,
  };
}

function forestSproutItem(overrides: { collectedCount?: number } = {}) {
  return {
    albumOrder: 1,
    collectedCount: overrides.collectedCount ?? 1,
    description: "森林守护者的幼年形态",
    factionId: null,
    factionName: null,
    firstCollectedAt: "2026-05-24T08:00:00.000Z",
    formId: null,
    imageUrl: null,
    isCollected: true,
    name: "森林幼芽",
    rarity: "common",
    seriesId: "12121212-1212-4212-8212-121212121212",
    seriesName: "森林守护者",
    templateId: "10101010-1010-4010-8010-101010101010",
    thumbUrl: null,
    type: "character",
  };
}

function forestElderItem() {
  return {
    albumOrder: 2,
    collectedCount: 1,
    description: "森林守护者的长老",
    factionId: null,
    factionName: null,
    firstCollectedAt: "2026-05-24T09:00:00.000Z",
    formId: null,
    imageUrl: null,
    isCollected: true,
    name: "森林长老",
    rarity: "common",
    seriesId: "12121212-1212-4212-8212-121212121212",
    seriesName: "森林守护者",
    templateId: "20202020-2020-4020-8020-202020202020",
    thumbUrl: null,
    type: "character",
  };
}

function moonGuardianItem() {
  return {
    albumOrder: 3,
    collectedCount: 1,
    description: "月冕卫队成员",
    factionId: null,
    factionName: null,
    firstCollectedAt: "2026-05-24T10:00:00.000Z",
    formId: null,
    imageUrl: null,
    isCollected: true,
    name: "月冕守门人",
    rarity: "legendary",
    seriesId: "23232323-2323-4232-8232-232323232323",
    seriesName: "月冕卫队",
    templateId: "30303030-3030-4030-8030-303030303030",
    thumbUrl: null,
    type: "character",
  };
}

function starEchoItem() {
  return {
    albumOrder: 4,
    collectedCount: 0,
    description: "尚未点亮的藏品",
    factionId: null,
    factionName: null,
    firstCollectedAt: null,
    formId: null,
    imageUrl: null,
    isCollected: false,
    name: "星回声",
    rarity: "epic",
    seriesId: "34343434-3434-4434-8434-343434343434",
    seriesName: "星河回声",
    templateId: "40404040-4040-4040-8040-404040404040",
    thumbUrl: null,
    type: "character",
  };
}

function claimRewardPayload(): AlbumClaimRewardResponse {
  return {
    balanceChanges: [
      {
        balanceAfter: 180,
        currency: "FGEMS",
        delta: 100,
      },
    ],
    bookId: BOOK_ALL_ID,
    claimedAt: "2026-05-25T08:00:00.000Z",
    milestoneId: MILESTONE_ALL_FIRST_ID,
    rewards: [
      {
        amount: 100,
        iconUrl: null,
        label: "100 FGEMS",
        rewardType: "FGEMS",
        templateId: null,
      },
    ],
    status: "claimed",
  };
}
