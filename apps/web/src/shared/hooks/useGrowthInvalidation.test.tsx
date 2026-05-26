import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/shared/constants/queryKeys";

import { useGrowthInvalidation } from "./useGrowthInvalidation";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  userId: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );

  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
    }),
  };
});

vi.mock("@/app/providers/SessionProvider", () => ({
  useSession: () => ({
    user: {
      id: mocks.userId,
    },
  }),
}));

const USER_ID = mocks.userId;
const ITEM_A_ID = "66666666-6666-4666-8666-666666666666";
const ITEM_B_ID = "66666666-6666-4666-8666-666666666667";
const ITEM_C_ID = "66666666-6666-4666-8666-666666666668";

describe("useGrowthInvalidation", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes inventory detail, inventory list and assets after upgrade", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterUpgrade({
        itemInstanceId: ITEM_A_ID,
      });
    });

    expectInvalidated(
      queryKeys.inventory.root,
      queryKeys.inventory.detail(USER_ID, ITEM_A_ID),
      queryKeys.me.assetsRoot,
    );
  });

  it("refreshes inventory, assets, album progress and leaderboard after successful evolution", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterEvolve({
        createdItemInstanceId: ITEM_C_ID,
        mainItemInstanceId: ITEM_B_ID,
        returnedItemInstanceId: null,
        sourceItemInstanceIds: [ITEM_A_ID, ITEM_B_ID],
        success: true,
      });
    });

    expectInvalidated(
      queryKeys.inventory.root,
      queryKeys.me.assetsRoot,
      queryKeys.inventory.detail(USER_ID, ITEM_A_ID),
      queryKeys.inventory.detail(USER_ID, ITEM_B_ID),
      queryKeys.inventory.detail(USER_ID, ITEM_C_ID),
      queryKeys.album.root,
      queryKeys.album.leaderboardRoot,
    );
  });

  it("does not refresh album progress after failed evolution", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterEvolve({
        createdItemInstanceId: null,
        mainItemInstanceId: ITEM_B_ID,
        returnedItemInstanceId: ITEM_B_ID,
        sourceItemInstanceIds: [ITEM_A_ID, ITEM_B_ID],
        success: false,
      });
    });

    expectInvalidated(
      queryKeys.inventory.root,
      queryKeys.me.assetsRoot,
      queryKeys.inventory.detail(USER_ID, ITEM_A_ID),
      queryKeys.inventory.detail(USER_ID, ITEM_B_ID),
    );
    expectNotInvalidated(queryKeys.album.root);
    expectNotInvalidated(queryKeys.album.leaderboardRoot);
  });

  it("refreshes inventory and assets after decomposition", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterDecompose({
        itemInstanceIds: [ITEM_A_ID],
      });
    });

    expectInvalidated(
      queryKeys.inventory.root,
      queryKeys.me.assetsRoot,
      queryKeys.inventory.detail(USER_ID, ITEM_A_ID),
    );
  });

  it("refreshes album and assets after claiming an album reward", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterAlbumRewardClaim();
    });

    expectInvalidated(queryKeys.album.root, queryKeys.me.assetsRoot);
  });

  it("refreshes task overview, check-in status, task list and assets after daily check-in", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterDailyCheckIn();
    });

    expectInvalidated(
      queryKeys.tasks.overview(USER_ID),
      queryKeys.tasks.checkInStatus(USER_ID),
      queryKeys.tasks.listRoot(USER_ID),
      queryKeys.me.assetsRoot,
    );
  });

  it("refreshes task list, overview, assets and reward history after claiming a task reward", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterTaskRewardClaim();
    });

    expectInvalidated(
      queryKeys.tasks.listRoot(USER_ID),
      queryKeys.tasks.overview(USER_ID),
      queryKeys.me.assetsRoot,
      queryKeys.tasks.rewardHistoryRoot(USER_ID),
    );
  });

  it("refreshes task list and invite stats after sharing an invite link", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterInviteShare();
    });

    expectInvalidated(
      queryKeys.tasks.listRoot(USER_ID),
      queryKeys.tasks.inviteStats(USER_ID),
      queryKeys.tasks.overview(USER_ID),
    );
  });

  it("refreshes invite stats and referral records after binding a referral", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterReferralBind();
    });

    expectInvalidated(
      queryKeys.tasks.inviteStats(USER_ID),
      queryKeys.tasks.referralRecordsRoot(USER_ID),
      queryKeys.tasks.overview(USER_ID),
    );
  });

  it("refreshes commission history, invite stats, assets and reward history after claiming commission", async () => {
    const { result } = renderHook(() => useGrowthInvalidation());

    await act(async () => {
      await result.current.invalidateAfterCommissionClaim();
    });

    expectInvalidated(
      queryKeys.tasks.commissionHistoryRoot(USER_ID),
      queryKeys.tasks.inviteStats(USER_ID),
      queryKeys.me.assetsRoot,
      queryKeys.tasks.rewardHistoryRoot(USER_ID),
      queryKeys.tasks.overview(USER_ID),
    );
  });
});

function expectInvalidated(...queryKeysToFind: Array<readonly unknown[]>) {
  for (const queryKey of queryKeysToFind) {
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey });
  }
}

function expectNotInvalidated(queryKey: readonly unknown[]) {
  expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey });
}
