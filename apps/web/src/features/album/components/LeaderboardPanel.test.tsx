import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AlbumLeaderboardEntry,
  AlbumLeaderboardResponse,
} from "../album.types";
import { LeaderboardPanel } from "./LeaderboardPanel";

const BASE_ENTRY: AlbumLeaderboardEntry = {
  rank: 1,
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "榜首玩家",
  avatarUrl: null,
  score: 225,
  completionPercent: 33.33,
  collectedCount: 4,
  totalCount: 12,
  rareCount: 1,
  epicCount: 1,
  legendaryCount: 2,
  mintCount: 0,
  updatedAt: "2026-05-24T14:30:17.958Z",
};

function createLeaderboard(
  overrides: Partial<AlbumLeaderboardResponse> = {},
): AlbumLeaderboardResponse {
  return {
    boardId: "22222222-2222-4222-8222-222222222222",
    period: "current_week",
    scope: "global",
    entries: [BASE_ENTRY],
    myEntry: BASE_ENTRY,
    nextCursor: null,
    generatedAt: "2026-05-24T14:30:17.958Z",
    empty: false,
    ...overrides,
  };
}

describe("LeaderboardPanel", () => {
  it("renders my rank, top entries and leaderboard metrics", () => {
    render(<LeaderboardPanel leaderboard={createLeaderboard()} />);

    expect(screen.getByRole("heading", { name: "每周图鉴榜" })).toBeVisible();
    expect(screen.getByLabelText("我的排名")).toHaveTextContent("#1");
    expect(screen.getByText("榜首玩家")).toBeVisible();
    expect(screen.getAllByText("33.33%")).toHaveLength(2);
    expect(screen.getAllByText("225")).toHaveLength(2);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    const firstRow = rows[0];

    if (!firstRow) {
      throw new Error("Expected leaderboard row to render.");
    }

    expect(firstRow).toHaveAttribute("data-rank-tier", "top");
    expect(firstRow).toHaveAttribute("data-current-user", "true");
    expect(within(firstRow).getByText("Mint")).toBeVisible();
  });

  it("shows the generating state without rendering fake entries", () => {
    render(
      <LeaderboardPanel
        leaderboard={createLeaderboard({
          boardId: null,
          entries: [],
          myEntry: null,
          generatedAt: null,
          empty: true,
        })}
      />,
    );

    expect(screen.getByText("榜单生成中")).toBeVisible();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("allows users to refresh the leaderboard", () => {
    const onRefresh = vi.fn();

    render(
      <LeaderboardPanel
        leaderboard={createLeaderboard({ entries: [], myEntry: null })}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "刷新排行榜" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
