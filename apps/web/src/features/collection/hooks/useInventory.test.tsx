import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CollectionInventoryItem,
  CollectionInventoryResponse,
} from "../collection.types";
import { useInventory } from "./useInventory";

const mocks = vi.hoisted(() => ({
  fetchInventory: vi.fn(),
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
  fetchInventory: mocks.fetchInventory,
}));

describe("useInventory", () => {
  beforeEach(() => {
    mocks.fetchInventory.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("continues fetching inventory pages until the collection snapshot is complete", async () => {
    mocks.fetchInventory
      .mockResolvedValueOnce(
        makeInventoryPage({
          items: [makeItem("66666666-6666-4666-8666-666666666666")],
          nextCursor: "1",
          offset: 0,
          total: 2,
        }),
      )
      .mockResolvedValueOnce(
        makeInventoryPage({
          items: [
            makeItem("77777777-7777-4777-8777-777777777777", "月冕守门人"),
          ],
          nextCursor: null,
          offset: 1,
          total: 2,
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
      expect(mocks.fetchInventory).toHaveBeenCalledTimes(2);
    });

    expect(mocks.fetchInventory).toHaveBeenNthCalledWith(1, {
      cursor: null,
      includeLocked: true,
      limit: 100,
    });
    expect(mocks.fetchInventory).toHaveBeenNthCalledWith(2, {
      cursor: "1",
      includeLocked: true,
      limit: 100,
    });
    expect(result.current.items.map((item) => item.itemInstanceId)).toEqual([
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ]);
    expect(result.current.total).toBe(2);

    queryClient.clear();
  });
});

function makeInventoryPage(input: {
  items: CollectionInventoryItem[];
  nextCursor: string | null;
  offset: number;
  total: number;
}): CollectionInventoryResponse {
  return {
    items: input.items,
    limit: 100,
    nextCursor: input.nextCursor,
    offset: input.offset,
    serverTime: "2026-05-25T08:00:00.000Z",
    statuses: ["available"],
    total: input.total,
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
