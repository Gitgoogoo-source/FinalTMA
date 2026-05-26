import { expect, test, type Page, type Route } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHARE_TASK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLAIMABLE_TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRADE_TASK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COMMISSION_ID_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMMISSION_ID_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const INVITE_URL = "https://t.me/test_bot/app?startapp=ref_TASK_E2E";
const SHARE_TEXT = "来开盒，完成首抽我们都拿奖励。";

type TaskMutationRequest = {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  method: string;
};

type TaskMockState = {
  empty: boolean;
  shareRecorded: boolean;
  checkedIn: boolean;
  taskClaimed: boolean;
  commissionClaimed: boolean;
  claimTaskShouldFail: boolean;
  claimTaskDelayMs: number;
  checkInDelayMs: number;
  commissionDelayMs: number;
  overviewRequests: URL[];
  assetRequests: URL[];
  referralLinkRequests: TaskMutationRequest[];
  shareRequests: TaskMutationRequest[];
  checkInRequests: TaskMutationRequest[];
  claimTaskRequests: TaskMutationRequest[];
  claimCommissionRequests: TaskMutationRequest[];
};

type TaskCaptureGlobal = typeof globalThis & {
  __copiedText?: string;
  __telegramShareUrls?: string[];
  Telegram?: {
    WebApp?: {
      ready?: () => void;
      expand?: () => void;
      openTelegramLink?: (url: string) => void;
      openLink?: (url: string) => void;
      onEvent?: () => void;
      offEvent?: () => void;
    };
  };
};

test("任务页邀请卡片可以生成、复制并打开 Telegram 分享", async ({ page }) => {
  const state = createTaskMockState();

  await installTaskBrowserCaptures(page);
  await mockFirstPhaseApi(page);
  await mockTasksApi(page, state, { trackAssets: true });
  await gotoTasks(page);

  const inviteCard = page.locator(".invite-campaign-card");
  const inviteStats = page.locator(".invite-stats-panel");

  await expect(page.getByTestId("tasks-page")).toBeVisible();
  await expect(inviteCard.getByRole("button", { name: "分享" })).toBeDisabled();
  await expect(inviteCard.getByRole("button", { name: "复制" })).toBeDisabled();
  await expect(inviteStats).toContainText("邀请人数");
  await expect(inviteStats).toContainText("3");
  await expect(inviteStats).toContainText("有效邀请");
  await expect(inviteStats).toContainText("2");
  await expect(inviteStats).toContainText("邀请奖励");
  await expect(inviteStats).toContainText("1,000");
  await expect(inviteStats).toContainText("分红收益");
  await expect(inviteStats).toContainText("40");

  await inviteCard.getByRole("button", { name: "生成链接" }).click();

  await expect.poll(() => state.referralLinkRequests.length).toBe(1);
  expect(state.referralLinkRequests[0]?.body).toMatchObject({
    scene: "TASK_PAGE",
    source: "task_center",
  });
  const inviteSheet = page.getByRole("dialog", { name: "分享给好友" });

  await expect(inviteSheet).toBeVisible();
  await expect(page.getByText("邀请链接已生成", { exact: true })).toBeVisible();
  await expect(inviteCard.getByRole("button", { name: "分享" })).toBeEnabled();
  await expect(inviteCard.getByRole("button", { name: "复制" })).toBeEnabled();

  const overviewRequestCount = state.overviewRequests.length;

  await inviteSheet.getByRole("button", { name: "复制" }).click();

  await expect.poll(() => state.shareRequests.length).toBe(1);
  expect(state.shareRequests[0]?.body).toMatchObject({
    scene: "TASK_PAGE",
    referral_code: "TASK_E2E",
    idempotency_key: expect.any(String),
  });
  expect(state.shareRequests[0]?.body).not.toHaveProperty("user_id");
  expect(state.shareRequests[0]?.headers["x-idempotency-key"]).toEqual(
    state.shareRequests[0]?.body.idempotency_key,
  );
  await expect.poll(() => readCopiedText(page)).toBe(INVITE_URL);
  await expect(page.getByText("链接已复制", { exact: true })).toBeVisible();
  await expect
    .poll(() => state.overviewRequests.length)
    .toBeGreaterThan(overviewRequestCount);

  const shareTaskRow = page.locator(".task-row").filter({
    hasText: "分享一次邀请链接",
  });
  await expect(shareTaskRow).toContainText("1/1");
  await expect(
    shareTaskRow.getByRole("button", { name: "领取" }),
  ).toBeEnabled();

  await installRuntimeShareCapture(page);
  await inviteSheet.getByRole("button", { name: "分享" }).click();

  await expect.poll(() => state.shareRequests.length).toBe(2);
  await expect.poll(() => readTelegramShareUrls(page)).toHaveLength(1);

  const shareUrls = await readTelegramShareUrls(page);
  const shareUrl = new URL(shareUrls[0] ?? "");

  expect(`${shareUrl.origin}${shareUrl.pathname}`).toBe(
    "https://t.me/share/url",
  );
  expect(shareUrl.searchParams.get("url")).toBe(INVITE_URL);
  expect(shareUrl.searchParams.get("text")).toBe(SHARE_TEXT);
  await expect(page.getByText("分享已记录", { exact: true })).toBeVisible();
});

test("任务页展示签到状态，签到后刷新签到和资产数据", async ({ page }) => {
  const state = createTaskMockState({ checkInDelayMs: 200 });

  await mockFirstPhaseApi(page);
  await mockTasksApi(page, state, { trackAssets: true });
  await gotoTasks(page);

  const checkInPanel = page.locator(".seven-day-check-in");
  const checkInCards = checkInPanel.locator(".check-in-reward-card");

  await expect(checkInPanel).toContainText("连续 1 天");
  await expect(checkInCards.nth(0)).toContainText("已领取");
  await expect(checkInCards.nth(1)).toContainText("可签到");
  await expect(checkInCards.nth(2)).toContainText("未解锁");

  const overviewRequestCount = state.overviewRequests.length;
  const assetRequestCount = state.assetRequests.length;
  const checkInButton = checkInPanel.getByRole("button", { name: "签到" });

  await expect(checkInButton).toBeEnabled();
  await checkInButton.click();
  await expect(
    checkInPanel.getByRole("button", { name: "签到中" }),
  ).toBeDisabled();

  await expect.poll(() => state.checkInRequests.length).toBe(1);
  expect(state.checkInRequests[0]?.body).toMatchObject({
    campaign_id: CAMPAIGN_ID,
    local_date: expect.any(String),
    timezone_offset_minutes: expect.any(Number),
    idempotency_key: expect.any(String),
  });
  expect(state.checkInRequests[0]?.body).not.toHaveProperty("user_id");
  expect(state.checkInRequests[0]?.headers["x-idempotency-key"]).toEqual(
    state.checkInRequests[0]?.body.idempotency_key,
  );

  const rewardDialog = page.getByRole("dialog", { name: "签到成功" });

  await expect(rewardDialog).toBeVisible();
  await expect(rewardDialog).toContainText("连续签到 2 天");
  await expect(rewardDialog).toContainText("KCOIN");
  await expect(rewardDialog).toContainText("+20");
  await rewardDialog.getByRole("button", { name: "收下" }).click();

  await expect
    .poll(() => state.overviewRequests.length)
    .toBeGreaterThan(overviewRequestCount);
  await expect
    .poll(() => state.assetRequests.length)
    .toBeGreaterThan(assetRequestCount);
  await expect(
    checkInPanel.getByRole("button", { name: "今日已签" }),
  ).toBeDisabled();
  await expect(checkInPanel).toContainText("连续 2 天");
  await expect(checkInCards.nth(1)).toContainText("已领取");
});

test("任务领奖展示 loading、防重复请求和成功反馈", async ({ page }) => {
  const state = createTaskMockState({ claimTaskDelayMs: 200 });

  await mockFirstPhaseApi(page);
  await mockTasksApi(page, state, { trackAssets: true });
  await gotoTasks(page);

  const taskList = page.locator(".task-list");
  const taskRow = taskList.locator(".task-row").filter({
    hasText: "完成一次开盒",
  });
  const claimButton = taskRow.getByRole("button", { name: "领取" });
  const overviewRequestCount = state.overviewRequests.length;
  const assetRequestCount = state.assetRequests.length;

  await expect(taskRow).toContainText("1/1");
  await expect(claimButton).toBeEnabled();
  await claimButton.click();
  await expect(taskRow.getByRole("button", { name: "领取中" })).toBeDisabled();
  await expect.poll(() => state.claimTaskRequests.length).toBe(1);
  expect(state.claimTaskRequests[0]?.body).toMatchObject({
    task_id: CLAIMABLE_TASK_ID,
    period_key: "2026-05-26",
    idempotency_key: expect.any(String),
  });
  expect(state.claimTaskRequests[0]?.body).not.toHaveProperty("user_id");
  expect(state.claimTaskRequests[0]?.headers["x-idempotency-key"]).toEqual(
    state.claimTaskRequests[0]?.body.idempotency_key,
  );

  const rewardDialog = page.getByRole("dialog", {
    name: "任务奖励已领取",
  });

  await expect(rewardDialog).toBeVisible();
  await expect(rewardDialog).toContainText("完成一次开盒");
  await expect(rewardDialog).toContainText("KCOIN");
  await expect(rewardDialog).toContainText("+50");
  await rewardDialog.getByRole("button", { name: "收下" }).click();

  await expect
    .poll(() => state.overviewRequests.length)
    .toBeGreaterThan(overviewRequestCount);
  await expect
    .poll(() => state.assetRequests.length)
    .toBeGreaterThan(assetRequestCount);
  await expect(
    taskList.locator(".task-row").filter({ hasText: "完成一次开盒" }),
  ).toHaveCount(0);
  await expect(page.locator(".reward-history-panel")).toContainText(
    "完成一次开盒",
  );
});

test("任务领奖失败时展示稳定错误 toast", async ({ page }) => {
  const state = createTaskMockState({ claimTaskShouldFail: true });

  await mockFirstPhaseApi(page);
  await mockTasksApi(page, state);
  await gotoTasks(page);

  const taskRow = page.locator(".task-row").filter({
    hasText: "完成一次开盒",
  });

  await taskRow.getByRole("button", { name: "领取" }).click();

  await expect.poll(() => state.claimTaskRequests.length).toBe(1);
  await expect(page.getByRole("alert")).toContainText("领取失败");
  await expect(page.getByRole("alert")).toContainText("该任务奖励已领取。");
});

test("分红领取后刷新统计、资产和奖励记录", async ({ page }) => {
  const state = createTaskMockState({ commissionDelayMs: 200 });

  await mockFirstPhaseApi(page);
  await mockTasksApi(page, state, { trackAssets: true });
  await gotoTasks(page);

  const commissionPanel = page.locator(".commission-panel");
  const overviewRequestCount = state.overviewRequests.length;
  const assetRequestCount = state.assetRequests.length;

  await expect(commissionPanel).toContainText("125 KCOIN");
  await expect(commissionPanel).toContainText("40 KCOIN");
  await expect(
    commissionPanel.getByRole("button", { name: "领取" }),
  ).toBeEnabled();

  await commissionPanel.getByRole("button", { name: "领取" }).click();

  const confirmDialog = page.getByRole("dialog", {
    name: "领取待结算分红",
  });

  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("125 KCOIN");
  await confirmDialog.getByRole("button", { name: "确认领取" }).click();
  await expect(
    commissionPanel.getByRole("button", { name: "领取中" }),
  ).toBeDisabled();

  await expect.poll(() => state.claimCommissionRequests.length).toBe(1);
  expect(state.claimCommissionRequests[0]?.body).toMatchObject({
    idempotency_key: expect.any(String),
  });
  expect(state.claimCommissionRequests[0]?.body).not.toHaveProperty("user_id");
  expect(
    state.claimCommissionRequests[0]?.headers["x-idempotency-key"],
  ).toEqual(state.claimCommissionRequests[0]?.body.idempotency_key);

  const rewardDialog = page.getByRole("dialog", { name: "分红已领取" });

  await expect(rewardDialog).toBeVisible();
  await expect(rewardDialog).toContainText("2 笔分红已结算。");
  await expect(rewardDialog).toContainText("KCOIN");
  await expect(rewardDialog).toContainText("+125");
  await rewardDialog.getByRole("button", { name: "收下" }).click();

  await expect
    .poll(() => state.overviewRequests.length)
    .toBeGreaterThan(overviewRequestCount);
  await expect
    .poll(() => state.assetRequests.length)
    .toBeGreaterThan(assetRequestCount);
  await expect(commissionPanel).toContainText("0 KCOIN");
  await expect(commissionPanel).toContainText("165 KCOIN");
  await expect(
    commissionPanel.getByRole("button", { name: "领取" }),
  ).toBeDisabled();
  await expect(page.locator(".reward-history-panel")).toContainText("邀请分红");
});

test("任务页空任务、未开放签到和无分红时不报错", async ({ page }) => {
  const state = createTaskMockState({ empty: true });

  await mockFirstPhaseApi(page);
  await mockTasksApi(page, state);
  await gotoTasks(page);

  await expect(page.getByTestId("tasks-page")).toBeVisible();
  await expect(page.getByText("签到活动未开放", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无任务", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无分红明细", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无奖励记录", { exact: true })).toBeVisible();
  await expect(
    page.locator(".commission-panel").getByRole("button", { name: "领取" }),
  ).toBeDisabled();
});

async function installTaskBrowserCaptures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const capture = globalThis as TaskCaptureGlobal;

    delete capture.__copiedText;
    capture.__telegramShareUrls = [];

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          capture.__copiedText = text;
        },
      },
    });

    Object.defineProperty(globalThis, "open", {
      configurable: true,
      value: (url?: string | URL) => {
        if (url) {
          capture.__telegramShareUrls?.push(String(url));
        }

        return null;
      },
    });

    capture.Telegram = {
      WebApp: {
        ready: () => undefined,
        expand: () => undefined,
        openTelegramLink: (url: string) => {
          capture.__telegramShareUrls?.push(url);
        },
        openLink: (url: string) => {
          capture.__telegramShareUrls?.push(url);
        },
        onEvent: () => undefined,
        offEvent: () => undefined,
      },
    };
  });
}

async function installRuntimeShareCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const capture = globalThis as TaskCaptureGlobal;

    capture.__telegramShareUrls = [];

    Object.defineProperty(globalThis, "open", {
      configurable: true,
      value: (url?: string | URL) => {
        if (url) {
          capture.__telegramShareUrls?.push(String(url));
        }

        return null;
      },
    });

    capture.Telegram = {
      ...(capture.Telegram ?? {}),
      WebApp: {
        ...(capture.Telegram?.WebApp ?? {}),
        openTelegramLink: (url: string) => {
          capture.__telegramShareUrls?.push(url);
        },
        openLink: (url: string) => {
          capture.__telegramShareUrls?.push(url);
        },
      },
    };
  });
}

async function gotoTasks(page: Page): Promise<void> {
  await page.goto(`/tasks?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await expect(page.getByTestId("tasks-page")).toBeVisible();
}

function createTaskMockState(
  overrides: Partial<
    Pick<
      TaskMockState,
      | "empty"
      | "claimTaskShouldFail"
      | "claimTaskDelayMs"
      | "checkInDelayMs"
      | "commissionDelayMs"
    >
  > = {},
): TaskMockState {
  return {
    empty: overrides.empty ?? false,
    shareRecorded: false,
    checkedIn: false,
    taskClaimed: false,
    commissionClaimed: false,
    claimTaskShouldFail: overrides.claimTaskShouldFail ?? false,
    claimTaskDelayMs: overrides.claimTaskDelayMs ?? 0,
    checkInDelayMs: overrides.checkInDelayMs ?? 0,
    commissionDelayMs: overrides.commissionDelayMs ?? 0,
    overviewRequests: [],
    assetRequests: [],
    referralLinkRequests: [],
    shareRequests: [],
    checkInRequests: [],
    claimTaskRequests: [],
    claimCommissionRequests: [],
  };
}

async function mockTasksApi(
  page: Page,
  state: TaskMockState,
  options: { trackAssets?: boolean } = {},
): Promise<void> {
  if (options.trackAssets) {
    await page.unroute("**/api/me/assets");
    await page.route("**/api/me/assets", (route) => {
      state.assetRequests.push(new URL(route.request().url()));

      return fulfillOk(route, myAssetsPayload(state));
    });
  }

  await page.route("**/api/tasks/overview", (route) => {
    state.overviewRequests.push(new URL(route.request().url()));

    return fulfillOk(route, taskOverviewPayload(state));
  });

  await page.route("**/api/tasks/referral-link", async (route) => {
    state.referralLinkRequests.push(readMutationRequest(route));

    await fulfillOk(route, {
      referral_code: "TASK_E2E",
      start_payload: "ref_TASK_E2E",
      invite_url: INVITE_URL,
      share_text: SHARE_TEXT,
      scene: "TASK_PAGE",
      source: "task_center",
    });
  });

  await page.route("**/api/tasks/share-event", async (route) => {
    state.shareRecorded = true;
    state.shareRequests.push(readMutationRequest(route));

    await fulfillOk(route, {
      accepted: true,
      event_id: "99999999-9999-4999-8999-999999999999",
      share_type: "TASK_PAGE",
      idempotent: false,
    });
  });

  await page.route("**/api/tasks/check-in", async (route) => {
    state.checkInRequests.push(readMutationRequest(route));
    await delay(state.checkInDelayMs);
    state.checkedIn = true;

    await fulfillOk(route, {
      signin_id: "12121212-1212-4121-8121-121212121212",
      campaign_id: CAMPAIGN_ID,
      already_claimed: false,
      day_index: 2,
      current_streak: 2,
      cycle_position: 2,
      total_signins: 2,
      rewards: [currencyReward("signin:kcoin:day-2", "KCOIN", 20)],
      checked_in_at: "2026-05-26T08:00:00.000Z",
      idempotent: false,
    });
  });

  await page.route("**/api/tasks/claim", async (route) => {
    state.claimTaskRequests.push(readMutationRequest(route));

    if (state.claimTaskShouldFail) {
      await fulfillApiError(route, {
        status: 409,
        code: "TASK_ALREADY_CLAIMED",
        message: "Task reward has already been claimed.",
      });
      return;
    }

    await delay(state.claimTaskDelayMs);
    state.taskClaimed = true;

    await fulfillOk(route, {
      claim_id: "34343434-3434-4343-8343-343434343434",
      task_id: CLAIMABLE_TASK_ID,
      period_key: "2026-05-26",
      status: "claimed",
      rewards: [currencyReward("task:kcoin:open-box", "KCOIN", 50)],
      claimed_at: "2026-05-26T08:05:00.000Z",
      idempotent: false,
    });
  });

  await page.route("**/api/tasks/claim-commission", async (route) => {
    state.claimCommissionRequests.push(readMutationRequest(route));
    await delay(state.commissionDelayMs);
    state.commissionClaimed = true;

    await fulfillOk(route, {
      processed: true,
      claimed: true,
      claimed_count: 2,
      claimed_amount_kcoin: 125,
      amount_kcoin: 125,
      commission_ids: [COMMISSION_ID_A, COMMISSION_ID_B],
      ledger_id: "56565656-5656-4565-8565-565656565656",
      status: "claimed",
      idempotent: false,
    });
  });
}

function taskOverviewPayload(state: TaskMockState) {
  const tasks = state.empty ? [] : taskItemsPayload(state);

  return {
    tasks,
    task_summary: {
      total_count: tasks.length,
      completed_count: tasks.filter((task) =>
        ["claimable", "claimed"].includes(task.status),
      ).length,
      claimed_count: tasks.filter((task) => task.status === "claimed").length,
      claimable_count: tasks.filter((task) => task.status === "claimable")
        .length,
    },
    signin_status: state.empty
      ? emptyCheckInStatusPayload()
      : checkInStatusPayload(state),
    invite_stats: state.empty
      ? emptyInviteStatsPayload()
      : inviteStatsPayload(state),
    referral_records: state.empty
      ? []
      : [
          {
            referral_id: "78787878-7878-4787-8787-787878787878",
            invitee_display_name: "好友 A",
            invite_code: "TASK_E2E",
            status: "qualified",
            qualified_at: "2026-05-25T08:30:00.000Z",
            rewarded_at: "2026-05-25T08:31:00.000Z",
            created_at: "2026-05-25T08:00:00.000Z",
            updated_at: "2026-05-25T08:31:00.000Z",
          },
        ],
    commission_history: commissionHistoryItemsPayload(state),
    commission_stats: commissionStatsPayload(state),
    server_time: "2026-05-26T08:10:00.000Z",
  };
}

function taskItemsPayload(state: TaskMockState) {
  return [
    {
      task_id: SHARE_TASK_ID,
      code: "DAILY_SHARE_INVITE",
      title: "分享一次邀请链接",
      description: "复制或分享到 Telegram 后由后端记录进度。",
      category: "social",
      action_type: "share_invite",
      status: state.shareRecorded ? "claimable" : "in_progress",
      period_type: "daily",
      period_key: "2026-05-26",
      progress: {
        current: state.shareRecorded ? 1 : 0,
        target: 1,
        percent: state.shareRecorded ? 100 : 0,
        completed_at: state.shareRecorded ? "2026-05-26T08:01:00.000Z" : null,
        claimed_at: null,
        updated_at: "2026-05-26T08:01:00.000Z",
      },
      rewards: [currencyReward("task:kcoin:share", "KCOIN", 10)],
      sort_order: 1,
      metadata: {},
    },
    {
      task_id: CLAIMABLE_TASK_ID,
      code: "DAILY_OPEN_BOX",
      title: "完成一次开盒",
      description: "今日已完成开盒，奖励由后端领取。",
      category: "daily",
      action_type: "claim_reward",
      status: state.taskClaimed ? "claimed" : "claimable",
      period_type: "daily",
      period_key: "2026-05-26",
      progress: {
        current: 1,
        target: 1,
        percent: 100,
        completed_at: "2026-05-26T07:50:00.000Z",
        claimed_at: state.taskClaimed ? "2026-05-26T08:05:00.000Z" : null,
        updated_at: "2026-05-26T08:05:00.000Z",
      },
      rewards: [currencyReward("task:kcoin:open-box", "KCOIN", 50)],
      sort_order: 2,
      metadata: {},
    },
    {
      task_id: TRADE_TASK_ID,
      code: "DAILY_LIST_MARKET",
      title: "上架一个藏品",
      description: "进入交易页完成一次上架。",
      category: "trade",
      action_type: "create_listing",
      status: "in_progress",
      period_type: "daily",
      period_key: "2026-05-26",
      progress: {
        current: 0,
        target: 1,
        percent: 0,
        completed_at: null,
        claimed_at: null,
        updated_at: "2026-05-26T07:00:00.000Z",
      },
      rewards: [currencyReward("task:fgems:trade", "FGEMS", 5)],
      sort_order: 3,
      metadata: {},
    },
  ];
}

function checkInStatusPayload(state: TaskMockState) {
  return {
    campaign: {
      campaign_id: CAMPAIGN_ID,
      code: "seven_day_default",
      title: "7 日签到",
      description: "连续签到领取奖励。",
      cycle_days: 7,
    },
    days: [
      {
        day_index: 1,
        title: "第 1 天",
        status: "claimed",
        rewards: [currencyReward("signin:kcoin:day-1", "KCOIN", 10)],
        claimed_at: "2026-05-25T08:00:00.000Z",
        claimed_date: "2026-05-25",
      },
      {
        day_index: 2,
        title: "第 2 天",
        status: state.checkedIn ? "claimed" : "available",
        rewards: [currencyReward("signin:kcoin:day-2", "KCOIN", 20)],
        claimed_at: state.checkedIn ? "2026-05-26T08:00:00.000Z" : null,
        claimed_date: state.checkedIn ? "2026-05-26" : null,
      },
      {
        day_index: 3,
        title: "第 3 天",
        status: "locked",
        rewards: [currencyReward("signin:fgems:day-3", "FGEMS", 5)],
        claimed_at: null,
        claimed_date: null,
      },
    ],
    current_streak: state.checkedIn ? 2 : 1,
    cycle_position: state.checkedIn ? 2 : 1,
    total_signins: state.checkedIn ? 2 : 1,
    already_claimed_today: state.checkedIn,
    next_day_index: state.checkedIn ? null : 2,
    server_date: "2026-05-26",
    server_time: "2026-05-26T08:10:00.000Z",
  };
}

function emptyCheckInStatusPayload() {
  return {
    campaign: null,
    days: [],
    current_streak: 0,
    cycle_position: 0,
    total_signins: 0,
    already_claimed_today: false,
    next_day_index: null,
    server_date: "2026-05-26",
    server_time: "2026-05-26T08:10:00.000Z",
  };
}

function inviteStatsPayload(state: TaskMockState) {
  return {
    summary: {
      invited_count: 3,
      valid_invite_count: 2,
      first_open_count: 2,
      total_reward_kcoin: 1000,
      commission_kcoin: state.commissionClaimed ? 165 : 40,
      pending_commission_kcoin: state.commissionClaimed ? 0 : 125,
      share_count: state.shareRecorded ? 1 : 0,
    },
    server_time: "2026-05-26T08:10:00.000Z",
  };
}

function emptyInviteStatsPayload() {
  return {
    summary: {
      invited_count: 0,
      valid_invite_count: 0,
      first_open_count: 0,
      total_reward_kcoin: 0,
      commission_kcoin: 0,
      pending_commission_kcoin: 0,
      share_count: 0,
    },
    server_time: "2026-05-26T08:10:00.000Z",
  };
}

function commissionHistoryItemsPayload(state: TaskMockState) {
  if (state.empty) {
    return [];
  }

  return [
    {
      commission_id: COMMISSION_ID_A,
      invitee_display_name: "好友 A",
      invitee_username: "friend_a",
      source_type: "gacha_open",
      base_amount_kcoin: 1000,
      commission_bps: 1000,
      commission_amount_kcoin: 100,
      ledger_id: state.commissionClaimed
        ? "abababab-abab-4aba-8aba-abababababab"
        : null,
      status: state.commissionClaimed ? "granted" : "pending",
      created_at: "2026-05-26T07:00:00.000Z",
      claimed_at: state.commissionClaimed ? "2026-05-26T08:07:00.000Z" : null,
    },
    {
      commission_id: COMMISSION_ID_B,
      invitee_display_name: "好友 B",
      invitee_username: "friend_b",
      source_type: "gacha_open",
      base_amount_kcoin: 250,
      commission_bps: 1000,
      commission_amount_kcoin: 25,
      ledger_id: state.commissionClaimed
        ? "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc"
        : null,
      status: state.commissionClaimed ? "granted" : "pending",
      created_at: "2026-05-26T07:30:00.000Z",
      claimed_at: state.commissionClaimed ? "2026-05-26T08:07:00.000Z" : null,
    },
    {
      commission_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      invitee_display_name: "历史好友",
      invitee_username: "old_friend",
      source_type: "gacha_open",
      base_amount_kcoin: 400,
      commission_bps: 1000,
      commission_amount_kcoin: 40,
      ledger_id: "dededede-dede-4ded-8ded-dededededede",
      status: "granted",
      created_at: "2026-05-25T08:00:00.000Z",
      claimed_at: "2026-05-25T08:20:00.000Z",
    },
  ];
}

function commissionStatsPayload(state: TaskMockState) {
  if (state.empty) {
    return {
      pending_count: 0,
      pending_amount_kcoin: 0,
      granted_count: 0,
      granted_amount_kcoin: 0,
      reversed_count: 0,
      reversed_amount_kcoin: 0,
    };
  }

  return {
    pending_count: state.commissionClaimed ? 0 : 2,
    pending_amount_kcoin: state.commissionClaimed ? 0 : 125,
    granted_count: state.commissionClaimed ? 3 : 1,
    granted_amount_kcoin: state.commissionClaimed ? 165 : 40,
    reversed_count: 0,
    reversed_amount_kcoin: 0,
  };
}

function myAssetsPayload(state: TaskMockState) {
  const kcoinAvailable =
    1200 +
    (state.checkedIn ? 20 : 0) +
    (state.taskClaimed ? 50 : 0) +
    (state.commissionClaimed ? 125 : 0);

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
        available: String(kcoinAvailable),
        locked: "0",
      },
      FGEMS: {
        available: "80",
        locked: "0",
      },
      STAR_DISPLAY: {
        available: "30",
        locked: "0",
      },
    },
    updated_at: "2026-05-26T08:10:00.000Z",
  };
}

function currencyReward(
  rewardId: string,
  currencyCode: "KCOIN" | "FGEMS",
  amount: number,
) {
  return {
    reward_id: rewardId,
    type: "currency",
    currency_code: currencyCode,
    label: currencyCode,
    amount,
    icon_url: null,
  };
}

function readMutationRequest(route: Route): TaskMutationRequest {
  return {
    body: parseJsonBody(route.request().postData()),
    headers: route.request().headers(),
    method: route.request().method(),
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

async function fulfillApiError(
  route: Route,
  input: { status: number; code: string; message: string },
): Promise<void> {
  await route.fulfill({
    status: input.status,
    contentType: "application/json",
    body: JSON.stringify({
      ok: false,
      success: false,
      error: {
        code: input.code,
        message: input.message,
      },
      requestId: "req_tasks_e2e_error",
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

async function readCopiedText(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (globalThis as TaskCaptureGlobal).__copiedText);
}

async function readTelegramShareUrls(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (globalThis as TaskCaptureGlobal).__telegramShareUrls ?? [],
  );
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
