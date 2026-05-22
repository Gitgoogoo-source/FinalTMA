import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const successResponse = JSON.stringify({
  ok: true,
  data: {
    status: "ok",
  },
});

describe("frontend auth api client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_APP_ENV", "test");
    vi.stubEnv("VITE_API_BASE_URL", "/api");
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", "test_bot");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses HttpOnly cookie credentials", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(successResponse),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRequest } = await import("../../apps/web/src/api/client");

    await apiRequest("/me/bootstrap", {
      method: "GET",
    });

    const requestInit = fetchMock.mock.calls[0]?.[1];

    expect(requestInit?.credentials).toBe("include");
  });

  it("notifies unauthorized handlers for protected API calls", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "AUTH_SESSION_EXPIRED",
              message: "Session expired.",
            },
          }),
          {
            status: 401,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRequest, setApiUnauthorizedHandler } =
      await import("../../apps/web/src/api/client");
    const onUnauthorized = vi.fn();

    setApiUnauthorizedHandler(onUnauthorized);

    await expect(
      apiRequest("/me/bootstrap", {
        method: "GET",
      }),
    ).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
      status: 401,
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not loop unauthorized handlers on the login endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "AUTH_INIT_DATA_INVALID",
              message: "Telegram initData is invalid.",
            },
          }),
          {
            status: 401,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRequest, setApiUnauthorizedHandler } =
      await import("../../apps/web/src/api/client");
    const onUnauthorized = vi.fn();

    setApiUnauthorizedHandler(onUnauthorized);

    await expect(
      apiRequest("/auth/telegram", {
        method: "POST",
        body: {
          initData: "invalid",
        },
      }),
    ).rejects.toMatchObject({
      code: "AUTH_INIT_DATA_INVALID",
      status: 401,
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("uses fixed first-phase messages instead of raw server text", async () => {
    const { ApiClientError, getApiErrorMessage } =
      await import("../../apps/web/src/api/errors");
    const error = new ApiClientError({
      code: "DROP_POOL_EMPTY",
      message: "raw database detail should not be shown",
      status: 409,
    });

    expect(getApiErrorMessage(error)).toBe("当前奖励池为空，暂时无法开盒。");
  });
});
