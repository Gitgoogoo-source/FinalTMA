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

import {
  apiRequest,
  setApiSessionToken,
  setApiUnauthorizedHandler,
} from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";
import { getApiErrorMessage, isUnauthorizedApiError } from "@/api/errors";
import { env } from "@/env";

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
  tokenType: "Bearer";
  accessToken: string;
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
const DEVELOPMENT_INIT_DATA_BYPASS = "development-init-data-bypass";

export function SessionProvider({ children }: SessionProviderProps) {
  const telegram = useTelegram();
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

  const clearSession = useCallback(() => {
    setApiSessionToken(null);
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
        setApiSessionToken(null);
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

    // 开发阶段临时注释掉原始 Telegram initData 拦截，方便直接打开网页验收。
    // 恢复 Telegram 登录时，将条件改回：if (!telegram.initData) {
    if (!telegram.initData && !isDevelopmentTelegramAuthBypassEnabled()) {
      setApiSessionToken(null);
      setStatus("error");
      setError({
        code: "AUTH_INIT_DATA_REQUIRED",
        message: telegram.error ?? "缺少 Telegram initData，无法完成登录。",
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
          body: buildTelegramLoginBody(telegram),
        },
      );

      setApiSessionToken(loginResponse.session.accessToken);
      setUser(loginResponse.user);
      setSession(loginResponse.session);
      setStatus("authenticated");
      await reloadBootstrap();
    } catch (requestError) {
      setApiSessionToken(null);
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
  }, [reloadBootstrap, telegram]);

  useEffect(() => {
    if (!telegram.isReady) {
      return;
    }

    void authenticate();
  }, [authenticate, telegram.isReady]);

  useEffect(() => {
    return setApiUnauthorizedHandler(() => {
      if (authInFlightRef.current) {
        return;
      }

      setApiSessionToken(null);
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
  const body: Record<string, unknown> = {
    initData: telegram.initData ?? DEVELOPMENT_INIT_DATA_BYPASS,
    clientContext: buildAuthClientContext(telegram),
  };

  if (Object.keys(telegram.initDataUnsafe).length > 0) {
    body.initDataUnsafe = telegram.initDataUnsafe;
  }

  if (telegram.startParam) {
    body.startParam = telegram.startParam;
  }

  return body;
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

function isDevelopmentTelegramAuthBypassEnabled(): boolean {
  return (
    !env.IS_PROD &&
    (env.APP_ENV === "local" ||
      env.APP_ENV === "development" ||
      env.APP_ENV === "test")
  );
}
