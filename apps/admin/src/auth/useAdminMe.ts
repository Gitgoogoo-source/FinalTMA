import { useCallback, useEffect, useState } from "react";

import { AdminApiError, fetchAdminMe } from "../admin.api";
import type { AdminMeResponse } from "../admin.types";

export type AdminMeStatus =
  | "loading"
  | "authenticated"
  | "session_expired"
  | "forbidden"
  | "network_error";

export type AdminMeError = {
  code: string;
  message: string;
  status: number | null;
  requestId: string | null;
};

type AdminMeState = {
  status: AdminMeStatus;
  me: AdminMeResponse | null;
  error: AdminMeError | null;
};

export function useAdminMe() {
  const [state, setState] = useState<AdminMeState>({
    status: "loading",
    me: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({
      status: current.me ? "authenticated" : "loading",
      me: current.me,
      error: null,
    }));

    try {
      const me = await fetchAdminMe();

      setState({
        status: "authenticated",
        me,
        error: null,
      });
    } catch (error) {
      const nextError = normalizeAdminMeError(error);

      setState({
        status: classifyAdminMeError(nextError),
        me: null,
        error: nextError,
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}

function normalizeAdminMeError(error: unknown): AdminMeError {
  if (error instanceof AdminApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      requestId: error.requestId ?? null,
    };
  }

  return {
    code: "ADMIN_NETWORK_ERROR",
    message:
      error instanceof Error ? error.message : "后台登录态校验请求失败。",
    status: null,
    requestId: null,
  };
}

function classifyAdminMeError(error: AdminMeError): AdminMeStatus {
  if (
    error.status === 401 ||
    error.code === "AUTH_SESSION_EXPIRED" ||
    error.code === "UNAUTHORIZED"
  ) {
    return "session_expired";
  }

  if (error.status === 403 || error.code === "FORBIDDEN") {
    return "forbidden";
  }

  return "network_error";
}
