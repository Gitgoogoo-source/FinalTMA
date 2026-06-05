import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CheckInStatus } from "../tasks.types";
import { SevenDayCheckIn } from "./SevenDayCheckIn";

describe("SevenDayCheckIn", () => {
  it("uses the available day copy as the real check-in action", () => {
    const onCheckIn = vi.fn();

    render(
      <SevenDayCheckIn
        isPending={false}
        onCheckIn={onCheckIn}
        status={createCheckInStatus()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "签到" }),
    ).not.toBeInTheDocument();

    const availableDayButton = screen.getByRole("button", {
      name: "签到 Day 1",
    });

    expect(availableDayButton).toHaveTextContent("可签到");

    fireEvent.click(availableDayButton);

    expect(onCheckIn).toHaveBeenCalledTimes(1);
  });

  it("disables the available day action while check-in is pending", () => {
    const onCheckIn = vi.fn();

    render(
      <SevenDayCheckIn
        isPending
        onCheckIn={onCheckIn}
        status={createCheckInStatus()}
      />,
    );

    const availableDayButton = screen.getByRole("button", {
      name: "签到 Day 1",
    });

    expect(availableDayButton).toBeDisabled();
    expect(availableDayButton).toHaveTextContent("签到中");

    fireEvent.click(availableDayButton);

    expect(onCheckIn).not.toHaveBeenCalled();
  });
});

function createCheckInStatus(): CheckInStatus {
  return {
    campaign: {
      campaignId: "11111111-1111-4111-8111-111111111111",
      code: "daily-7",
      title: "7 Day Sign-In",
      description: null,
      cycleDays: 7,
    },
    days: Array.from({ length: 7 }, (_, index) => {
      const dayIndex = index + 1;

      return {
        dayIndex,
        title: `Day ${dayIndex}`,
        status: dayIndex === 1 ? "available" : "locked",
        rewards: [],
        claimedAt: null,
        claimedDate: null,
      };
    }),
    currentStreak: 0,
    cyclePosition: 1,
    totalSignins: 0,
    alreadyClaimedToday: false,
    nextDayIndex: 1,
    serverDate: "2026-06-05",
    serverTime: "2026-06-05T00:00:00.000Z",
  };
}
