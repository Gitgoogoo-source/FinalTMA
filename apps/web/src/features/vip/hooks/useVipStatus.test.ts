import { describe, expect, it } from "vitest";

import type { VipStatus } from "../vip.types";
import {
  getVipStatusStaleTime,
  readCachedVipStatusRecord,
  VIP_STATUS_CACHE_STORAGE_KEY,
  writeCachedVipStatus,
} from "./useVipStatus";

type CreateVipStatusOverrides = Omit<Partial<VipStatus>, "today"> & {
  today?: Partial<NonNullable<VipStatus["today"]>> | null | undefined;
};

describe("getVipStatusStaleTime", () => {
  it("keeps VIP status fresh until the current UTC business day ends", () => {
    expect(
      getVipStatusStaleTime(
        createVipStatus({
          serverTime: "2026-06-05T10:00:00.000Z",
          today: {
            businessDateUtc: "2026-06-05",
          },
        }),
      ),
    ).toBe(14 * 60 * 60_000);
  });

  it("expires earlier when the VIP period ends before the business day ends", () => {
    expect(
      getVipStatusStaleTime(
        createVipStatus({
          currentPeriodEnd: "2026-06-05T10:30:00.000Z",
          serverTime: "2026-06-05T10:00:00.000Z",
          today: {
            businessDateUtc: "2026-06-05",
          },
        }),
      ),
    ).toBe(30 * 60_000);
  });

  it("treats expired VIP status as stale immediately", () => {
    expect(
      getVipStatusStaleTime(
        createVipStatus({
          currentPeriodEnd: "2026-06-05T09:59:59.000Z",
          serverTime: "2026-06-05T10:00:00.000Z",
        }),
      ),
    ).toBe(0);
  });

  it("uses the local UTC day boundary when the server time is unavailable", () => {
    expect(
      getVipStatusStaleTime(
        createVipStatus({
          serverTime: null,
          today: null,
        }),
        Date.UTC(2026, 5, 5, 10, 0, 0),
      ),
    ).toBe(14 * 60 * 60_000);
  });
});

describe("VIP status local cache", () => {
  it("stores and restores a fresh VIP status for the same user", () => {
    const storage = createMemoryStorage();
    const status = createVipStatus();

    writeCachedVipStatus(
      "user-1",
      status,
      storage,
      new Date("2026-06-05T10:00:00.000Z"),
    );

    expect(storage.getItem(VIP_STATUS_CACHE_STORAGE_KEY)).not.toBeNull();
    expect(
      readCachedVipStatusRecord(
        "user-1",
        storage,
        Date.parse("2026-06-05T11:00:00.000Z"),
      )?.status,
    ).toEqual(status);
  });

  it("drops cached VIP status after the UTC business day expires", () => {
    const storage = createMemoryStorage();

    writeCachedVipStatus(
      "user-1",
      createVipStatus({
        serverTime: "2026-06-05T10:00:00.000Z",
        today: {
          businessDateUtc: "2026-06-05",
        },
      }),
      storage,
      new Date("2026-06-05T10:00:00.000Z"),
    );

    expect(
      readCachedVipStatusRecord(
        "user-1",
        storage,
        Date.parse("2026-06-06T00:00:01.000Z"),
      ),
    ).toBeNull();
    expect(storage.getItem(VIP_STATUS_CACHE_STORAGE_KEY)).toBeNull();
  });

  it("does not reuse another user's cached VIP status", () => {
    const storage = createMemoryStorage();

    writeCachedVipStatus(
      "user-1",
      createVipStatus(),
      storage,
      new Date("2026-06-05T10:00:00.000Z"),
    );

    expect(
      readCachedVipStatusRecord(
        "user-2",
        storage,
        Date.parse("2026-06-05T11:00:00.000Z"),
      ),
    ).toBeNull();
  });
});

function createVipStatus(overrides: CreateVipStatusOverrides = {}): VipStatus {
  const { today: todayOverride, ...statusOverrides } = overrides;
  const today =
    todayOverride === null
      ? null
      : {
          businessDateUtc: "2026-06-05",
          canClaim: true,
          claimId: null,
          claimed: false,
          fgemsAmount: 0,
          fgemsClaimed: false,
          fgemsClaimedAt: null,
          canClaimFgems: true,
          freeBoxAvailable: false,
          freeBoxClaimed: false,
          freeBoxClaimedAt: null,
          canClaimFreeBox: false,
          freeBoxCount: 0,
          freeBoxUsedCount: 0,
          remainingFreeBoxCount: 0,
          ...todayOverride,
        };

  return {
    currentPeriodEnd: "2026-07-05T00:00:00.000Z",
    isVip: true,
    plan: null,
    serverTime: "2026-06-05T10:00:00.000Z",
    subscriptionId: "sub-1",
    today,
    todayClaimed: false,
    ...statusOverrides,
  };
}

function createMemoryStorage(): Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
> {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
