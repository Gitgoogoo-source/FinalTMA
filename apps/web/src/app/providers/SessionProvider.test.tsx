import "@testing-library/jest-dom/vitest";

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_ENDPOINTS } from "@/api/endpoints";

import { SessionProvider, useSession } from "./SessionProvider";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  telegram: {
    colorScheme: "dark",
    error: null,
    initData: "auth_date=1779321600&user=%7B%22id%22%3A7001%7D&hash=test",
    isReady: true,
    launchSource: "direct",
    platform: "ios",
    version: "8.0",
    viewportHeight: 720,
    viewportStableHeight: 680,
  },
  unauthorizedHandler: null as (() => void) | null,
}));

vi.mock("@/api/client", () => ({
  apiRequest: mocks.apiRequest,
  setApiUnauthorizedHandler: (handler: (() => void) | null) => {
    mocks.unauthorizedHandler = handler;

    return () => {
      if (mocks.unauthorizedHandler === handler) {
        mocks.unauthorizedHandler = null;
      }
    };
  },
}));

vi.mock("./TelegramProvider", () => ({
  useTelegram: () => mocks.telegram,
}));

describe("SessionProvider", () => {
  beforeEach(() => {
    mocks.telegram = {
      colorScheme: "dark",
      error: null,
      initData: "auth_date=1779321600&user=%7B%22id%22%3A7001%7D&hash=test",
      isReady: true,
      launchSource: "direct",
      platform: "ios",
      version: "8.0",
      viewportHeight: 720,
      viewportStableHeight: 680,
    };
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockImplementation(async (path: string) => {
      if (path === API_ENDPOINTS.auth.telegram) {
        return {
          isNewUser: false,
          session: {
            cookieBased: true,
            expiresAt: "2026-05-25T10:00:00.000Z",
            expiresInSeconds: 3600,
            sessionId: "session-1",
          },
          status: "ok",
          user: {
            avatarUrl: null,
            firstName: "Test",
            id: "11111111-1111-4111-8111-111111111111",
            inviteCode: null,
            languageCode: "zh",
            lastName: null,
            telegramUserId: "7001",
            username: null,
          },
        };
      }

      if (path === API_ENDPOINTS.auth.refresh) {
        return {
          session: {
            cookieBased: true,
            expiresAt: "2026-05-25T11:00:00.000Z",
            expiresInSeconds: 3600,
            sessionId: "session-2",
          },
          status: "ok",
          user: {
            avatarUrl: null,
            firstName: "Test",
            id: "11111111-1111-4111-8111-111111111111",
            inviteCode: null,
            languageCode: "zh",
            lastName: null,
            telegramUserId: "7001",
            username: null,
          },
        };
      }

      if (path === API_ENDPOINTS.auth.logout) {
        return {
          revokedSessionCount: 1,
          status: "ok",
        };
      }

      if (path === API_ENDPOINTS.me.bootstrap) {
        return {};
      }

      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-authenticate when Telegram viewport values change", async () => {
    const view = render(
      <SessionProvider>
        <SessionStatusProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(getAuthRequestCount()).toBe(1);
    });
    await waitFor(() => {
      expect(getStatusProbe(view.container)).toHaveTextContent("authenticated");
    });

    mocks.telegram = {
      ...mocks.telegram,
      viewportHeight: 640,
      viewportStableHeight: 620,
    };

    view.rerender(
      <SessionProvider>
        <SessionStatusProbe />
      </SessionProvider>,
    );

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(getAuthRequestCount()).toBe(1);
    expect(getStatusProbe(view.container)).toHaveTextContent("authenticated");
  });

  it("refreshes the current backend session without Telegram re-auth", async () => {
    const view = render(
      <SessionProvider>
        <SessionActionsProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(getStatusProbe(view.container)).toHaveTextContent("authenticated");
    });

    fireEvent.click(getActionButton(view.container, "refresh-session"));

    await waitFor(() => {
      expect(getRefreshRequestCount()).toBe(1);
    });

    expect(getAuthRequestCount()).toBe(1);
    expect(getSessionIdProbe(view.container)).toHaveTextContent("session-2");
  });

  it("logs out through the backend and clears local session state", async () => {
    const view = render(
      <SessionProvider>
        <SessionActionsProbe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(getStatusProbe(view.container)).toHaveTextContent("authenticated");
    });

    fireEvent.click(getActionButton(view.container, "logout-all"));

    await waitFor(() => {
      expect(getLogoutRequestCount()).toBe(1);
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(API_ENDPOINTS.auth.logout, {
      method: "POST",
      body: {
        allDevices: true,
      },
    });
    expect(getStatusProbe(view.container)).toHaveTextContent("idle");
    expect(getSessionIdProbe(view.container)).toHaveTextContent("none");
  });
});

function SessionStatusProbe() {
  const session = useSession();

  return <div data-testid="session-status">{session.status}</div>;
}

function SessionActionsProbe() {
  const session = useSession();

  return (
    <div>
      <div data-testid="session-status">{session.status}</div>
      <div data-testid="session-id">{session.session?.sessionId ?? "none"}</div>
      <button
        data-testid="refresh-session"
        onClick={() => void session.refreshSession()}
        type="button"
      >
        refresh
      </button>
      <button
        data-testid="logout-all"
        onClick={() => void session.logout({ allDevices: true })}
        type="button"
      >
        logout
      </button>
    </div>
  );
}

function getAuthRequestCount(): number {
  return mocks.apiRequest.mock.calls.filter(
    ([path]) => path === API_ENDPOINTS.auth.telegram,
  ).length;
}

function getRefreshRequestCount(): number {
  return mocks.apiRequest.mock.calls.filter(
    ([path]) => path === API_ENDPOINTS.auth.refresh,
  ).length;
}

function getLogoutRequestCount(): number {
  return mocks.apiRequest.mock.calls.filter(
    ([path]) => path === API_ENDPOINTS.auth.logout,
  ).length;
}

function getStatusProbe(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-testid="session-status"]');

  if (!(element instanceof HTMLElement)) {
    throw new Error("Session status probe is missing.");
  }

  return element;
}

function getSessionIdProbe(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-testid="session-id"]');

  if (!(element instanceof HTMLElement)) {
    throw new Error("Session id probe is missing.");
  }

  return element;
}

function getActionButton(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Action button ${testId} is missing.`);
  }

  return element;
}
