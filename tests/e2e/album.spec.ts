import { expect, test, type Page, type Route } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOOK_ALL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOK_FOREST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOOK_LEGENDARY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MILESTONE_ALL_FIRST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MILESTONE_ALL_FULL_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MILESTONE_FOREST_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

type ClaimRequest = {
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

type AlbumMockState = {
  emptyConfig: boolean;
  emptyLeaderboard: boolean;
  claimed: boolean;
  progressRequests: URL[];
  seriesRequests: URL[];
  leaderboardRequests: URL[];
  claimRequests: ClaimRequest[];
  assetRequests: URL[];
};

test("图鉴页展示空图鉴配置状态", async ({ page }) => {
  const state = createAlbumMockState({
    emptyConfig: true,
    emptyLeaderboard: true,
  });

  await mockFirstPhaseApi(page);
  await mockAlbumApi(page, state);
  await gotoAlbum(page);

  await expect(page.getByText("暂无图鉴册", { exact: true })).toBeVisible();
  await expect(page.getByText("图鉴配置生成中", { exact: true })).toBeVisible();
  await expect(
    page.getByText("当前没有可展示的图鉴册，稍后刷新后再查看。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("暂无里程碑奖励", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无图鉴物品", { exact: true })).toBeVisible();
  await expect(page.getByText("榜单生成中", { exact: true })).toBeVisible();
});

test("图鉴册切换后物品和里程碑跟随当前图鉴册变化", async ({ page }) => {
  const state = createAlbumMockState();

  await mockFirstPhaseApi(page);
  await mockAlbumApi(page, state);
  await gotoAlbum(page);

  const progressPanel = page.locator(".album-progress");
  const tabs = page.locator(".album-tabs");

  await expect(
    progressPanel.getByRole("heading", { name: "全图鉴" }),
  ).toBeVisible();
  await expect(page.getByText("月冕守门人", { exact: true })).toBeVisible();
  await expect(page.getByText("全图鉴初阶奖励", { exact: true })).toBeVisible();
  await expect(tabs.getByRole("button", { name: /全图鉴/ })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await tabs.getByRole("button", { name: /森林守护者/ }).click();

  await expect
    .poll(() => state.progressRequests.at(-1)?.searchParams.get("book_id"))
    .toBe(BOOK_FOREST_ID);
  await expect(
    progressPanel.getByRole("heading", { name: "森林守护者" }),
  ).toBeVisible();
  await expect(page.getByText("森林长老", { exact: true })).toBeVisible();
  await expect(page.getByText("森林守护者奖励", { exact: true })).toBeVisible();
  await expect(page.getByText("月冕守门人", { exact: true })).toHaveCount(0);
  await expect(page.getByText("全图鉴初阶奖励", { exact: true })).toHaveCount(
    0,
  );
});

test("领取图鉴奖励后刷新图鉴和资产数据", async ({ page }) => {
  const state = createAlbumMockState();

  await mockFirstPhaseApi(page);
  await mockAlbumApi(page, state, { trackAssets: true });
  await gotoAlbum(page);

  await expect(page.getByText("全图鉴初阶奖励", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "领取", exact: true }),
  ).toBeEnabled();

  const progressRequestCount = state.progressRequests.length;
  const leaderboardRequestCount = state.leaderboardRequests.length;
  const assetRequestCount = state.assetRequests.length;

  await page.getByRole("button", { name: "领取", exact: true }).click();

  await expect.poll(() => state.claimRequests.length).toBe(1);
  expect(state.claimRequests[0]?.body).toMatchObject({
    milestone_id: MILESTONE_ALL_FIRST_ID,
    book_id: BOOK_ALL_ID,
    expected_milestone_version: 0,
    idempotency_key: expect.any(String),
  });
  expect(state.claimRequests[0]?.headers["x-idempotency-key"]).toEqual(
    state.claimRequests[0]?.body.idempotency_key,
  );

  const rewardDialog = page.getByRole("dialog", {
    name: "图鉴奖励已领取",
  });
  await expect(rewardDialog).toBeVisible();
  await expect(rewardDialog.getByText("100 FGEMS")).toBeVisible();
  await expect(rewardDialog.getByText("+100")).toBeVisible();
  await rewardDialog.getByRole("button", { name: "收下" }).click();

  await expect
    .poll(() => state.progressRequests.length)
    .toBeGreaterThan(progressRequestCount);
  await expect
    .poll(() => state.leaderboardRequests.length)
    .toBeGreaterThan(leaderboardRequestCount);
  await expect
    .poll(() => state.assetRequests.length)
    .toBeGreaterThan(assetRequestCount);
  await expect(
    page
      .locator(".album-milestone-row")
      .filter({ hasText: "全图鉴初阶奖励" })
      .locator(".album-milestone-row__status")
      .getByText("已领取", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "已领取", exact: true }),
  ).toBeDisabled();
});

test("排行榜没有条目时展示空态而不是假榜单", async ({ page }) => {
  const state = createAlbumMockState({ emptyLeaderboard: true });

  await mockFirstPhaseApi(page);
  await mockAlbumApi(page, state);
  await gotoAlbum(page);

  const leaderboardPanel = page.locator(".leaderboard-panel");

  await expect(
    page.locator(".album-progress").getByRole("heading", { name: "全图鉴" }),
  ).toBeVisible();
  await expect(
    leaderboardPanel.getByText("榜单生成中", { exact: true }),
  ).toBeVisible();
  await expect(leaderboardPanel.locator(".leaderboard-row")).toHaveCount(0);
  await expect(
    leaderboardPanel.getByRole("button", { name: "刷新排行榜" }),
  ).toBeEnabled();
});

test("排行榜有条目时在图鉴页展示我的排名和榜单数据", async ({ page }) => {
  const state = createAlbumMockState();

  await mockFirstPhaseApi(page);
  await mockAlbumApi(page, state);
  await gotoAlbum(page);

  await expect.poll(() => state.leaderboardRequests.length).toBeGreaterThan(0);

  const leaderboardRequest = state.leaderboardRequests.at(-1);

  expect(leaderboardRequest?.searchParams.get("period")).toBe("current_week");
  expect(leaderboardRequest?.searchParams.get("scope")).toBe("global");
  expect(leaderboardRequest?.searchParams.get("sort")).toBe("score_desc");
  expect(leaderboardRequest?.searchParams.get("limit")).toBe("50");

  const leaderboardPanel = page.locator(".leaderboard-panel");
  const myRank = leaderboardPanel.locator(".leaderboard-my-rank");
  const rows = leaderboardPanel.getByRole("listitem");
  const firstRow = rows.first();

  await expect(
    leaderboardPanel.getByRole("heading", { name: "每周图鉴榜" }),
  ).toBeVisible();
  await expect(
    leaderboardPanel.getByText("榜单生成中", { exact: true }),
  ).toHaveCount(0);
  await expect(myRank).toContainText("我的排名");
  await expect(myRank).toContainText("#1");
  await expect(myRank).toContainText("33.33%");
  await expect(myRank).toContainText("80");
  await expect(rows).toHaveCount(1);
  await expect(firstRow).toHaveAttribute("data-current-user", "true");
  await expect(firstRow).toHaveAttribute("data-rank-tier", "top");
  await expect(firstRow.getByLabel("第 1 名")).toBeVisible();
  await expect(firstRow.getByText("测试玩家", { exact: true })).toBeVisible();
  await expect(firstRow.getByText("1 / 3", { exact: true })).toBeVisible();
  await expect(firstRow.getByText("33.33%", { exact: true })).toBeVisible();
  await expect(firstRow.getByText("80", { exact: true })).toBeVisible();
});

function createAlbumMockState(
  overrides: Partial<
    Pick<AlbumMockState, "emptyConfig" | "emptyLeaderboard">
  > = {},
): AlbumMockState {
  return {
    emptyConfig: overrides.emptyConfig ?? false,
    emptyLeaderboard: overrides.emptyLeaderboard ?? false,
    claimed: false,
    progressRequests: [],
    seriesRequests: [],
    leaderboardRequests: [],
    claimRequests: [],
    assetRequests: [],
  };
}

async function mockAlbumApi(
  page: Page,
  state: AlbumMockState,
  options: { trackAssets?: boolean } = {},
): Promise<void> {
  if (options.trackAssets) {
    await page.unroute("**/api/me/assets");
    await page.route("**/api/me/assets", (route) => {
      state.assetRequests.push(new URL(route.request().url()));

      return fulfillOk(route, myAssetsPayload(state));
    });
  }

  await page.route("**/api/album/series?*", (route) => {
    state.seriesRequests.push(new URL(route.request().url()));

    return fulfillOk(route, albumSeriesPayload(state));
  });

  await page.route("**/api/album/progress?*", (route) => {
    const url = new URL(route.request().url());

    state.progressRequests.push(url);

    return fulfillOk(
      route,
      albumProgressPayload(url.searchParams.get("book_id"), state),
    );
  });

  await page.route("**/api/album/leaderboard?*", (route) => {
    state.leaderboardRequests.push(new URL(route.request().url()));

    return fulfillOk(route, albumLeaderboardPayload(state));
  });

  await page.route("**/api/album/claim-reward", async (route) => {
    const body = parseJsonBody(route.request().postData());

    state.claimed = true;
    state.claimRequests.push({
      body,
      headers: route.request().headers(),
    });

    await fulfillOk(route, {
      milestone_id: MILESTONE_ALL_FIRST_ID,
      book_id: BOOK_ALL_ID,
      status: "claimed",
      rewards: [
        {
          reward_type: "FGEMS",
          amount: 100,
          label: "100 FGEMS",
          icon_url: null,
        },
      ],
      balance_changes: [
        {
          currency: "FGEMS",
          delta: 100,
          balance_after: 180,
        },
      ],
      claimed_at: "2026-05-25T08:00:00.000Z",
    });
  });
}

async function gotoAlbum(page: Page): Promise<void> {
  await page.goto(`/album?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await expect(page.getByTestId("album-page")).toBeVisible();
}

function albumSeriesPayload(state: AlbumMockState) {
  if (state.emptyConfig) {
    return {
      books: [],
      total: 0,
      limit: 50,
      offset: 0,
      next_cursor: null,
      server_time: "2026-05-25T08:00:00.000Z",
    };
  }

  const books = [bookAllPayload(), bookForestPayload(), bookLegendary()];

  return {
    books,
    total: books.length,
    limit: 50,
    offset: 0,
    next_cursor: null,
    server_time: "2026-05-25T08:00:00.000Z",
  };
}

function albumProgressPayload(bookId: string | null, state: AlbumMockState) {
  if (state.emptyConfig) {
    return {
      book: null,
      items: [],
      milestones: [],
      rarity_summary: [],
      series_summary: [],
      empty: true,
      server_time: "2026-05-25T08:00:00.000Z",
    };
  }

  if (bookId === BOOK_FOREST_ID) {
    return {
      book: bookForestPayload(),
      items: [forestSproutItem({ collectedCount: 2 }), forestElderItem()],
      milestones: [
        {
          milestone_id: MILESTONE_FOREST_ID,
          book_id: BOOK_FOREST_ID,
          required_count: 2,
          required_percent: 100,
          title: "森林守护者奖励",
          status: "claimable",
          rewards: [
            {
              reward_type: "KCOIN",
              amount: 200,
              label: "200 KCOIN",
              icon_url: null,
            },
          ],
          claimed_at: null,
          version: 0,
        },
      ],
      rarity_summary: [
        {
          rarity: "common",
          total_count: 2,
          collected_count: 2,
        },
      ],
      series_summary: [
        {
          series_id: "12121212-1212-4212-8212-121212121212",
          series_name: "森林守护者",
          total_count: 2,
          collected_count: 2,
        },
      ],
      empty: false,
      server_time: "2026-05-25T08:00:00.000Z",
    };
  }

  return {
    book: bookAllPayload(),
    items: [forestSproutItem(), moonGuardianItem(), starEchoItem()],
    milestones: [
      {
        milestone_id: MILESTONE_ALL_FIRST_ID,
        book_id: BOOK_ALL_ID,
        required_count: 1,
        required_percent: 33.33,
        title: "全图鉴初阶奖励",
        status: state.claimed ? "claimed" : "claimable",
        rewards: [
          {
            reward_type: "FGEMS",
            amount: 100,
            label: "100 FGEMS",
            icon_url: null,
          },
        ],
        claimed_at: state.claimed ? "2026-05-25T08:00:00.000Z" : null,
        version: 0,
      },
      {
        milestone_id: MILESTONE_ALL_FULL_ID,
        book_id: BOOK_ALL_ID,
        required_count: 3,
        required_percent: 100,
        title: "全图鉴完整奖励",
        status: "locked",
        rewards: [
          {
            reward_type: "KCOIN",
            amount: 300,
            label: "300 KCOIN",
            icon_url: null,
          },
        ],
        claimed_at: null,
        version: 0,
      },
    ],
    rarity_summary: [
      {
        rarity: "common",
        total_count: 1,
        collected_count: 1,
      },
      {
        rarity: "legendary",
        total_count: 1,
        collected_count: 0,
      },
    ],
    series_summary: [
      {
        series_id: "12121212-1212-4212-8212-121212121212",
        series_name: "森林守护者",
        total_count: 2,
        collected_count: 1,
      },
      {
        series_id: "23232323-2323-4232-8232-232323232323",
        series_name: "月冕卫队",
        total_count: 1,
        collected_count: 0,
      },
    ],
    empty: false,
    server_time: "2026-05-25T08:00:00.000Z",
  };
}

function albumLeaderboardPayload(state: AlbumMockState) {
  if (state.emptyLeaderboard) {
    return {
      board_id: null,
      period: "current_week",
      scope: "global",
      entries: [],
      my_entry: null,
      next_cursor: null,
      generated_at: null,
      empty: true,
    };
  }

  const entry = {
    rank: 1,
    user_id: USER_ID,
    display_name: "测试玩家",
    avatar_url: null,
    score: state.claimed ? 180 : 80,
    completion_percent: 33.33,
    collected_count: 1,
    total_count: 3,
    rare_count: 0,
    epic_count: 0,
    legendary_count: 0,
    mint_count: 0,
    updated_at: "2026-05-25T08:00:00.000Z",
  };

  return {
    board_id: "abababab-abab-4aba-8aba-abababababab",
    period: "current_week",
    scope: "global",
    entries: [entry],
    my_entry: entry,
    next_cursor: null,
    generated_at: "2026-05-25T08:00:00.000Z",
    empty: false,
  };
}

function bookAllPayload() {
  return {
    book_id: BOOK_ALL_ID,
    code: "all",
    book_type: "all",
    name: "全图鉴",
    description: "全部藏品图鉴",
    cover_url: null,
    total_count: 3,
    collected_count: 1,
    completion_percent: 33.33,
    is_event_limited: false,
    starts_at: null,
    ends_at: null,
  };
}

function bookForestPayload() {
  return {
    book_id: BOOK_FOREST_ID,
    code: "series_forest_guardians",
    book_type: "series",
    name: "森林守护者",
    description: "森林守护者系列",
    cover_url: null,
    total_count: 2,
    collected_count: 2,
    completion_percent: 100,
    is_event_limited: false,
    starts_at: null,
    ends_at: null,
  };
}

function bookLegendary() {
  return {
    book_id: BOOK_LEGENDARY_ID,
    code: "rarity_legendary",
    book_type: "rarity",
    name: "传说图鉴",
    description: "传说稀有度图鉴",
    cover_url: null,
    total_count: 1,
    collected_count: 0,
    completion_percent: 0,
    is_event_limited: false,
    starts_at: null,
    ends_at: null,
  };
}

function forestSproutItem(overrides: { collectedCount?: number } = {}) {
  return {
    template_id: "10101010-1010-4010-8010-101010101010",
    form_id: null,
    name: "森林幼芽",
    description: "森林守护者的幼年形态",
    rarity: "common",
    type: "character",
    series_id: "12121212-1212-4212-8212-121212121212",
    series_name: "森林守护者",
    faction_id: null,
    faction_name: null,
    image_url: null,
    thumb_url: null,
    is_collected: true,
    first_collected_at: "2026-05-24T08:00:00.000Z",
    collected_count: overrides.collectedCount ?? 1,
    album_order: 1,
  };
}

function forestElderItem() {
  return {
    template_id: "20202020-2020-4020-8020-202020202020",
    form_id: null,
    name: "森林长老",
    description: "森林守护者的长老",
    rarity: "common",
    type: "character",
    series_id: "12121212-1212-4212-8212-121212121212",
    series_name: "森林守护者",
    faction_id: null,
    faction_name: null,
    image_url: null,
    thumb_url: null,
    is_collected: true,
    first_collected_at: "2026-05-24T09:00:00.000Z",
    collected_count: 1,
    album_order: 2,
  };
}

function moonGuardianItem() {
  return {
    template_id: "30303030-3030-4030-8030-303030303030",
    form_id: null,
    name: "月冕守门人",
    description: "月冕卫队成员",
    rarity: "legendary",
    type: "character",
    series_id: "23232323-2323-4232-8232-232323232323",
    series_name: "月冕卫队",
    faction_id: null,
    faction_name: null,
    image_url: null,
    thumb_url: null,
    is_collected: true,
    first_collected_at: "2026-05-24T10:00:00.000Z",
    collected_count: 1,
    album_order: 3,
  };
}

function starEchoItem() {
  return {
    template_id: "40404040-4040-4040-8040-404040404040",
    form_id: null,
    name: "星回声",
    description: "尚未点亮的藏品",
    rarity: "epic",
    type: "character",
    series_id: "34343434-3434-4434-8434-343434343434",
    series_name: "星河回声",
    faction_id: null,
    faction_name: null,
    image_url: null,
    thumb_url: null,
    is_collected: false,
    first_collected_at: null,
    collected_count: 0,
    album_order: 4,
  };
}

function myAssetsPayload(state: AlbumMockState) {
  return {
    profile: {
      id: USER_ID,
      telegram_user_id: "7001",
      username: "tester",
      display_name: "测试玩家",
      avatar_url: null,
    },
    balances: {
      KCOIN: {
        available: "1200",
        locked: "0",
      },
      FGEMS: {
        available: state.claimed ? "180" : "80",
        locked: "0",
      },
      STAR_DISPLAY: {
        available: "30",
        locked: "0",
      },
    },
    updated_at: "2026-05-25T08:00:00.000Z",
  };
}

async function fulfillOk(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      success: true,
      data,
    }),
  });
}

function parseJsonBody(body: string | null): Record<string, unknown> {
  if (!body) {
    return {};
  }

  const parsed = JSON.parse(body) as unknown;

  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
