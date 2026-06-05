import { describe, expect, it } from "vitest";

import type { VipStatus } from "../vip.types";
import { getVipStatusStaleTime } from "./useVipStatus";

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
          freeBoxAvailable: false,
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
