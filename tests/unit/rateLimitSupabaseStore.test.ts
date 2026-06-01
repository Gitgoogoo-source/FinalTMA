import { describe, expect, it, vi } from "vitest";

import { createRateLimiter } from "../../packages/server/src/security/rateLimit";

describe("Supabase RPC rate-limit store", () => {
  it("uses the configured schema and RPC for shared buckets", async () => {
    const rpcMock = vi.fn(async () => ({
      data: {
        allowed: true,
        current_count: 1,
        max_hits: 2,
        remaining: 1,
        reset_at: "2026-05-21T00:01:00.000Z",
        retry_after_ms: 0,
        reason: "allowed",
      },
      error: null,
    }));
    const schemaMock = vi.fn(() => ({
      rpc: rpcMock,
    }));

    const limiter = createRateLimiter({
      supabase: {
        schema: schemaMock,
      } as never,
      rpcName: "ops_check_rate_limit",
      rpcSchema: "api",
      failOpen: false,
      rules: [
        {
          action: "auth.telegram",
          scope: "ip",
          windowMs: 60_000,
          max: 2,
          blockMs: 120_000,
        },
      ],
    });

    const result = await limiter.assert({
      action: "auth.telegram",
      ip: "203.0.113.10",
      now: new Date("2026-05-21T00:00:00.000Z"),
    });

    expect(result.allowed).toBe(true);
    expect(schemaMock).toHaveBeenCalledWith("api");
    expect(rpcMock).toHaveBeenCalledWith(
      "ops_check_rate_limit",
      expect.objectContaining({
        p_action: "auth.telegram",
        p_scope: "ip",
        p_limit: 2,
        p_window_ms: 60_000,
        p_block_ms: 120_000,
      }),
    );
  });
});
