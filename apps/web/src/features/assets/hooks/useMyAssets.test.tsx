import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { API_ENDPOINTS } from "@/api/endpoints";

import { useMyAssets } from "./useMyAssets";

const mocks = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111",
  apiRequest: vi.fn(),
  session: {
    bootstrap: null as Record<string, unknown> | null,
    isAuthenticated: true,
    user: {
      avatarUrl: null as string | null,
      displayName: null as string | null,
      firstName: "Telegram",
      id: "11111111-1111-4111-8111-111111111111",
      lastName: null as string | null,
      telegramUserId: "7001",
      username: "telegram_name",
    },
  },
}));

vi.mock("@/api/client", () => ({
  apiRequest: mocks.apiRequest,
}));

vi.mock("@/app/providers/SessionProvider", () => ({
  useSession: () => mocks.session,
}));

describe("useMyAssets", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.session = {
      bootstrap: {
        profile: {
          id: mocks.userId,
          telegram_user_id: "7001",
          username: "profile_user",
          first_name: "Profile",
          last_name: "Name",
          display_name: "测试昵称",
          avatar_url: "https://example.test/profile.png",
        },
        balances: {
          KCOIN: { available: "500", locked: "0" },
          FGEMS: { available: "20", locked: "0" },
        },
        server_time: "2026-06-02T00:00:00.000Z",
      },
      isAuthenticated: true,
      user: {
        avatarUrl: null,
        displayName: null,
        firstName: "Telegram",
        id: mocks.userId,
        lastName: null,
        telegramUserId: "7001",
        username: "telegram_name",
      },
    };
    mocks.apiRequest.mockResolvedValue({
      userId: mocks.userId,
      balances: {
        KCOIN: { currencyCode: "KCOIN", available: "1200", locked: "0" },
        FGEMS: { currencyCode: "FGEMS", available: "35", locked: "0" },
      },
      updatedAt: "2026-06-02T00:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses bootstrap profile as the fallback when the assets endpoint omits profile fields", async () => {
    const { result } = renderHook(() => useMyAssets(), {
      wrapper: createQueryWrapper(),
    });

    expect(result.current.profile.displayName).toBe("测试昵称");
    expect(result.current.profile.avatarUrl).toBe(
      "https://example.test/profile.png",
    );

    await waitFor(() => {
      expect(result.current.data.updatedAt).toBe("2026-06-02T00:01:00.000Z");
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(API_ENDPOINTS.me.assets, {
      method: "GET",
    });
    expect(result.current.assets.kcoin.available).toBe("1200");
    expect(result.current.assets.fgems.available).toBe("35");
    expect(result.current.profile.displayName).toBe("测试昵称");
    expect(result.current.profile.avatarUrl).toBe(
      "https://example.test/profile.png",
    );
  });
});

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}
