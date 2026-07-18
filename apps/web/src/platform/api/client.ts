import { routes, type RouteDefinition } from "@pokepets/contracts";

import {
  clearSessionCache,
  getSession,
  replaceSession,
} from "../session/store.ts";
import { telegram } from "../telegram/index.ts";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly operationId: string | null,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

type ApiResult<T> = {
  data: T;
  requestId: string;
  operationId: string | null;
  status: number;
};
type Options = {
  idempotencyKey?: string;
  signal?: AbortSignal;
  recoverSession?: boolean;
};

let recoveryAttempted = false;
let recovery: Promise<void> | null = null;

export async function apiRequest<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  routeId: string,
  input: Record<string, unknown> = {},
  options: Options = {},
): Promise<ApiResult<T>> {
  const route = routeById(routeId);
  const result = await send<T>(route, input, options);
  if (result instanceof ApiFailure && result.code === "ACCOUNT_RESTRICTED") {
    const session = getSession();
    if (session) {
      replaceSession({ ...session, accountStatus: "banned" });
      clearSessionCache();
    }
  }
  if (
    result instanceof ApiFailure &&
    result.code === "SESSION_EXPIRED" &&
    options.recoverSession !== false &&
    route.id !== "auth.telegram"
  ) {
    try {
      if (!recovery) {
        if (recoveryAttempted) {
          await clearSession();
          throw result;
        }
        await markSessionRecovering();
      }
      await recoverSession();
      return apiRequest<T>(routeId, input, {
        ...options,
        recoverSession: false,
      });
    } catch (cause) {
      await clearSession();
      throw cause;
    }
  }
  if (
    result instanceof ApiFailure &&
    ["SESSION_REPLACED", "SESSION_REQUIRED"].includes(result.code)
  ) {
    await clearSession();
  }
  if (result instanceof ApiFailure) throw result;
  return result;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function routeById(id: string): RouteDefinition {
  const route = routes.find((item) => item.id === id);
  if (!route) throw new Error(`Unknown contract route: ${id}`);
  return route;
}

async function send<T extends Record<string, unknown>>(
  route: RouteDefinition,
  input: Record<string, unknown>,
  options: Options,
): Promise<ApiResult<T> | ApiFailure> {
  const path = route.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) =>
    encodeURIComponent(String(input[name] ?? "")),
  );
  const url = new URL(path, window.location.origin);
  const headers = new Headers({ accept: "application/json" });
  const token = getSession()?.token;
  if (route.auth && token) headers.set("authorization", `Bearer ${token}`);
  const idempotencyKey = route.idempotent
    ? (options.idempotencyKey ?? newIdempotencyKey())
    : null;
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  let body: string | undefined;
  if (route.method === "GET") {
    for (const [key, value] of Object.entries(input))
      if (
        value !== undefined &&
        !path.includes(encodeURIComponent(String(value)))
      )
        url.searchParams.set(key, String(value));
  } else {
    headers.set("content-type", "application/json");
    body = JSON.stringify(input);
  }
  const request = () =>
    fetch(url, {
      method: route.method,
      headers,
      ...(body ? { body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  let response: Response;
  try {
    response = await request();
  } catch {
    if (!route.idempotent || options.signal?.aborted)
      return new ApiFailure(
        0,
        "NETWORK_ERROR",
        "网络请求失败，请检查网络后重试",
        true,
        null,
      );
    try {
      response = await request();
    } catch {
      return new ApiFailure(
        0,
        "NETWORK_ERROR",
        "网络请求失败；服务器结果未知，请稍后从操作记录恢复",
        true,
        idempotencyKey,
      );
    }
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    const error = payload?.error as Record<string, unknown> | undefined;
    return new ApiFailure(
      response.status,
      String(error?.code ?? "API_ERROR"),
      String(error?.message ?? "请求失败"),
      Boolean(error?.retryable),
      stringOrNull(payload?.operation_id),
    );
  }
  if (route.compatibility === "c1")
    return {
      data: (payload?.data ?? {}) as T,
      requestId: String(payload?.request_id ?? ""),
      operationId: null,
      status: response.status,
    };
  return {
    data: (payload?.data ?? {}) as T,
    requestId: String(payload?.request_id ?? ""),
    operationId: stringOrNull(payload?.operation_id),
    status: response.status,
  };
}

async function recoverSession(): Promise<void> {
  recoveryAttempted = true;
  recovery ??= (async () => {
    const initData = telegram()?.initData;
    if (!initData)
      throw new ApiFailure(
        401,
        "TELEGRAM_REENTRY_REQUIRED",
        "请从 Telegram Mini App 重新打开应用",
        false,
        null,
      );
    const result = await send<{
      access_token: string;
      user_id: string;
      account_status: "normal" | "banned";
      expires_at: string;
    }>(
      routeById("auth.telegram"),
      { init_data: initData },
      { recoverSession: false },
    );
    if (result instanceof ApiFailure) throw result;
    replaceSession({
      token: result.data.access_token,
      userId: result.data.user_id,
      accountStatus: result.data.account_status,
      expiresAt: result.data.expires_at,
    });
    clearSessionCache();
  })().finally(() => {
    recovery = null;
  });
  return recovery;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function markSessionRecovering(): Promise<void> {
  const session = getSession();
  if (session) replaceSession({ ...session, recovering: true });
  clearSessionCache();
}

async function clearSession(): Promise<void> {
  replaceSession(null);
  clearSessionCache();
}
