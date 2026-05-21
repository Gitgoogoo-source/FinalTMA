import { beforeEach, describe, expect, it, vi } from "vitest";

describe("assets api normalizers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_APP_ENV", "test");
    vi.stubEnv("VITE_API_BASE_URL", "/api");
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", "test_bot");
  });

  it("normalizes /api/me/assets response and keeps missing balances at zero", async () => {
    const { normalizeMyAssetsResponse } =
      await import("../../apps/web/src/features/assets/assets.api");

    const normalized = normalizeMyAssetsResponse(
      {
        userId: "user-1",
        balances: {
          KCOIN: { available: "1200", locked: "0" },
          FGEMS: { available: 35, locked: null },
        },
        updatedAt: "2026-05-21T00:00:00.000Z",
      },
      {
        id: "user-1",
        firstName: "Ada",
        username: "ada",
        avatarUrl: "https://example.com/avatar.png",
      },
    );

    expect(normalized.assets.kcoin.available).toBe("1200");
    expect(normalized.assets.fgems.available).toBe("35");
    expect(normalized.assets.stars.available).toBe("0");
    expect(normalized.profile.displayName).toBe("Ada");
    expect(normalized.wallet.label).toBe("Connect Wallet");
  });

  it("normalizes bootstrap balances and snake_case profile fields", async () => {
    const { normalizeBootstrapAssets } =
      await import("../../apps/web/src/features/assets/assets.api");

    const normalized = normalizeBootstrapAssets({
      profile: {
        id: "user-2",
        telegram_user_id: "42",
        username: "player42",
        first_name: "Lin",
        last_name: "Q",
        avatar_url: "https://example.com/lin.png",
      },
      balances: {
        KCOIN: { available: 0, locked: 0 },
        FGEMS: { available: "0", locked: "0" },
        STAR_DISPLAY: { available: "15", locked: "0" },
      },
      server_time: "2026-05-21T00:00:00.000Z",
    });

    expect(normalized?.profile.displayName).toBe("Lin Q");
    expect(normalized?.assets.kcoin.available).toBe("0");
    expect(normalized?.assets.stars.available).toBe("15");
    expect(normalized?.updatedAt).toBe("2026-05-21T00:00:00.000Z");
  });
});
