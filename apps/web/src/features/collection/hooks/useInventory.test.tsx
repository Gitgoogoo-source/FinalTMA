import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CollectionInventoryItem,
  CollectionInventorySummaryResponse,
} from "../collection.types";
import { useInventory } from "./useInventory";

const mocks = vi.hoisted(() => ({
  fetchInventorySummary: vi.fn(),
  session: {
    isAuthenticated: true,
    user: {
      id: "11111111-1111-4111-8111-111111111111",
    },
  },
}));

vi.mock("@/app/providers/SessionProvider", () => ({
  useSession: () => mocks.session,
}));

vi.mock("../collection.api", () => ({
  fetchInventorySummary: mocks.fetchInventorySummary,
}));

describe("useInventory", () => {
  beforeEach(() => {
    mocks.fetchInventorySummary.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches one grouped inventory summary instead of auto-loading every page", async () => {
    const firstItem = makeItem("66666666-6666-4666-8666-666666666666");
    const secondItem = makeItem(
      "77777777-7777-4777-8777-777777777777",
      "月冕守门人",
    );

    mocks.fetchInventorySummary.mockResolvedValueOnce(
      makeInventorySummary({
        groups: [
          makeGroup(firstItem, 1),
          makeGroup(secondItem, 12),
        ],
        total: 13,
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useInventory(), { wrapper });

    await waitFor(() => {
      expect(mocks.fetchInventorySummary).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    expect(mocks.fetchInventorySummary).toHaveBeenCalledWith({
      includeLocked: true,
    });
    expect(result.current.items.map((item) => item.itemInstanceId)).toEqual([
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ]);
    expect(result.current.groups.map((group) => group.ownedCount)).toEqual([
      1, 12,
    ]);
    expect(result.current.total).toBe(13);

    queryClient.clear();
  });
});

function makeInventorySummary(input: {
  groups: CollectionInventorySummaryResponse["groups"];
  total: number;
}): CollectionInventorySummaryResponse {
  return {
    groupTotal: input.groups.length,
    groups: input.groups,
    items: input.groups.map((group) => group.representativeItem),
    serverTime: "2026-05-25T08:00:00.000Z",
    summary: {
      availableCount: input.total,
      groupCount: input.groups.length,
      listedCount: 0,
      lockedCount: 0,
      mintedCount: 0,
      mintingCount: 0,
      totalCount: input.total,
    },
    statuses: ["available"],
    total: input.total,
  };
}

function makeGroup(
  representativeItem: CollectionInventoryItem,
  ownedCount: number,
): CollectionInventorySummaryResponse["groups"][number] {
  return {
    availableCount: ownedCount,
    itemInstanceIds: [representativeItem.itemInstanceId],
    key: `template:${representativeItem.templateId}`,
    latestObtainedAt: representativeItem.obtainedAt,
    listedCount: 0,
    lockedCount: 0,
    maxLevel: representativeItem.level,
    maxPower: representativeItem.power,
    mintedCount: 0,
    mintingCount: 0,
    ownedCount,
    representativeItem,
  };
}

function makeItem(
  itemInstanceId: string,
  name = "森林幼芽",
): CollectionInventoryItem {
  return {
    avatarUrl: null,
    description: null,
    form: {
      description: null,
      displayName: "基础形态",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      index: 1,
    },
    imageUrl: null,
    isDecomposable: true,
    isEvolvable: true,
    isMintable: true,
    isTradeable: true,
    isUpgradeable: true,
    itemInstanceId,
    level: 1,
    name,
    nftMintStatus: null,
    obtainedAt: "2026-05-25T08:00:00.000Z",
    power: 10,
    rarity: {
      code: "common",
      label: "普通",
      sortOrder: 10,
    },
    serialNo: null,
    series: null,
    sourceId: null,
    sourceType: "gacha",
    status: "available",
    subtitle: null,
    templateId: "55555555-5555-4555-8555-555555555555",
    templateSlug: "forest_sproutling",
    thumbnailUrl: null,
    typeCode: "character",
  };
}
