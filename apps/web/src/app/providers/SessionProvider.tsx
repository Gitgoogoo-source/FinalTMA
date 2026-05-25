import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiRequest, setApiUnauthorizedHandler } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";
import { getApiErrorMessage, isUnauthorizedApiError } from "@/api/errors";

import { useTelegram } from "./TelegramProvider";

type SessionProviderProps = {
  children: ReactNode;
};

type SessionStatus = "idle" | "authenticating" | "authenticated" | "error";
type BootstrapStatus = "idle" | "loading" | "success" | "error";

type SessionUser = {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
  avatarUrl: string | null;
  inviteCode: string | null;
};

type AppSession = {
  sessionId: string;
  expiresAt: string;
  expiresInSeconds: number | null;
  cookieBased: boolean;
};

type LoginResponse = {
  status: "ok";
  isNewUser: boolean;
  user: SessionUser;
  session: AppSession;
};

type SessionError = {
  code: string;
  message: string;
};

type SessionContextValue = {
  status: SessionStatus;
  bootstrapStatus: BootstrapStatus;
  user: SessionUser | null;
  session: AppSession | null;
  bootstrap: Record<string, unknown> | null;
  error: SessionError | null;
  bootstrapError: SessionError | null;
  isAuthenticated: boolean;
  authenticate: () => Promise<void>;
  reloadBootstrap: () => Promise<void>;
  clearSession: () => void;
};

type AuthClientContext = {
  platform?: string;
  theme?: "light" | "dark";
  appVersion?: string;
  launchSource?: "direct" | "start_param" | "referral" | "group" | "unknown";
  viewportHeight?: number;
  viewportStableHeight?: number;
  colorScheme?: "light" | "dark";
  userAgent?: string;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: SessionProviderProps) {
  const telegram = useTelegram();
  const latestTelegramRef = useRef(telegram);
  const authInFlightRef = useRef(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [bootstrapStatus, setBootstrapStatus] =
    useState<BootstrapStatus>("idle");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const [bootstrap, setBootstrap] = useState<Record<string, unknown> | null>(
    null,
  );
  const [error, setError] = useState<SessionError | null>(null);
  const [bootstrapError, setBootstrapError] = useState<SessionError | null>(
    null,
  );

  latestTelegramRef.current = telegram;

  const clearSession = useCallback(() => {
    setStatus("idle");
    setBootstrapStatus("idle");
    setUser(null);
    setSession(null);
    setBootstrap(null);
    setError(null);
    setBootstrapError(null);
  }, []);

  const reloadBootstrap = useCallback(async () => {
    setBootstrapStatus("loading");
    setBootstrapError(null);

    try {
      const payload = await apiRequest<Record<string, unknown>>(
        API_ENDPOINTS.me.bootstrap,
        {
          method: "GET",
        },
      );

      setBootstrap(payload);
      setBootstrapStatus("success");
    } catch (requestError) {
      setBootstrap(null);
      setBootstrapStatus("error");
      setBootstrapError({
        code: "BOOTSTRAP_LOAD_FAILED",
        message: getApiErrorMessage(requestError),
      });

      if (isUnauthorizedApiError(requestError)) {
        setUser(null);
        setSession(null);
        setStatus("error");
        setError({
          code: "AUTH_SESSION_EXPIRED",
          message: "登录已失效，请重新进入 Telegram Mini App。",
        });
      }
    }
  }, []);

  const authenticate = useCallback(async () => {
    if (authInFlightRef.current) {
      return;
    }

    const latestTelegram = latestTelegramRef.current;

    if (!latestTelegram.initData) {
      setStatus("error");
      setError({
        code: "AUTH_INIT_DATA_REQUIRED",
        message:
          latestTelegram.error ?? "缺少 Telegram initData，无法完成登录。",
      });
      setUser(null);
      setSession(null);
      return;
    }

    setStatus("authenticating");
    setError(null);
    authInFlightRef.current = true;

    try {
      const loginResponse = await apiRequest<LoginResponse>(
        API_ENDPOINTS.auth.telegram,
        {
          method: "POST",
          body: buildTelegramLoginBody(latestTelegram),
        },
      );

      setUser(loginResponse.user);
      setSession(loginResponse.session);
      setStatus("authenticated");
      await reloadBootstrap();
    } catch (requestError) {
      setUser(null);
      setSession(null);
      setBootstrap(null);
      setStatus("error");
      setError({
        code: "AUTH_TELEGRAM_LOGIN_FAILED",
        message: getApiErrorMessage(requestError),
      });
    } finally {
      authInFlightRef.current = false;
    }
  }, [reloadBootstrap]);

  useEffect(() => {
    if (!telegram.isReady) {
      return;
    }

    void authenticate();
  }, [authenticate, telegram.initData, telegram.isReady]);

  useEffect(() => {
    return setApiUnauthorizedHandler(() => {
      if (authInFlightRef.current) {
        return;
      }

      void authenticate();
    });
  }, [authenticate]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      bootstrapStatus,
      user,
      session,
      bootstrap,
      error,
      bootstrapError,
      isAuthenticated: status === "authenticated" && Boolean(session),
      authenticate,
      reloadBootstrap,
      clearSession,
    }),
    [
      authenticate,
      bootstrap,
      bootstrapError,
      bootstrapStatus,
      clearSession,
      error,
      reloadBootstrap,
      session,
      status,
      user,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used inside SessionProvider.");
  }

  return value;
}

function buildTelegramLoginBody(
  telegram: ReturnType<typeof useTelegram>,
): Record<string, unknown> {
  return {
    initData: telegram.initData,
    clientContext: buildAuthClientContext(telegram),
  };
}

function buildAuthClientContext(
  telegram: ReturnType<typeof useTelegram>,
): AuthClientContext {
  const context: AuthClientContext = {
    theme: telegram.colorScheme,
    colorScheme: telegram.colorScheme,
    launchSource: telegram.launchSource,
  };

  if (telegram.platform) {
    context.platform = telegram.platform;
  }

  if (telegram.version) {
    context.appVersion = telegram.version;
  }

  if (telegram.viewportHeight) {
    context.viewportHeight = telegram.viewportHeight;
  }

  if (telegram.viewportStableHeight) {
    context.viewportStableHeight = telegram.viewportStableHeight;
  }

  if (typeof navigator !== "undefined" && navigator.userAgent.trim()) {
    context.userAgent = navigator.userAgent.slice(0, 1024);
  }

  return context;
}
