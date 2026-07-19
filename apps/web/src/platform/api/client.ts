import {
  parseRouteInput,
  parseRouteResult,
  routeById,
  standardErrorSchema,
  type RouteId,
  type RouteInput,
  type RouteOutput,
} from "@pokepets/api-contracts";

import {
  clearSessionCache,
  getSession,
  replaceSession,
} from "../session/store.ts";
import { getWebPublicConfig } from "../env/index.ts";
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

export type ApiResult<T> = {
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

export async function apiRequest<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id>,
  options: Options = {},
): Promise<ApiResult<RouteOutput<Id>>> {
  const parsedInput = parseRouteInput(routeId, input) as Record<
    string,
    unknown
  >;
  const result = await send(routeId, parsedInput, options);
  if (result instanceof ApiFailure && result.code === "ACCOUNT_RESTRICTED") {
    const session = getSession();
    if (session) replaceSession({ ...session, accountStatus: "banned" });
    clearSessionCache();
  }
  if (
    result instanceof ApiFailure &&
    result.code === "SESSION_EXPIRED" &&
    options.recoverSession !== false &&
    routeId !== "identity.authenticate"
  ) {
    try {
      if (!recovery) {
        if (recoveryAttempted) {
          clearSession();
          throw result;
        }
        markSessionRecovering();
      }
      await recoverSession();
      return apiRequest(routeId, input, { ...options, recoverSession: false });
    } catch (cause) {
      clearSession();
      throw cause;
    }
  }
  if (
    result instanceof ApiFailure &&
    ["SESSION_REPLACED", "SESSION_REQUIRED"].includes(result.code)
  )
    clearSession();
  if (result instanceof ApiFailure) throw result;
  return result;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function send<Id extends RouteId>(
  routeId: Id,
  input: Record<string, unknown>,
  options: Options,
): Promise<ApiResult<RouteOutput<Id>> | ApiFailure> {
  const route = routeById(routeId);
  const pathParams = new Set<string>();
  const path = route.path.replace(
    /:([A-Za-z0-9_]+)/g,
    (_match, name: string) => {
      pathParams.add(name);
      return encodeURIComponent(String(input[name]));
    },
  );
  const url = new URL(path, getWebPublicConfig().apiBaseUrl);
  const headers = new Headers({ accept: "application/json" });
  const token = getSession()?.token;
  if (route.auth && token) headers.set("authorization", `Bearer ${token}`);
  if (route.idempotent && !options.idempotencyKey)
    throw new Error(`Idempotency-Key is required for ${routeId}`);
  const operationId = route.idempotent
    ? (options.idempotencyKey ?? null)
    : null;
  if (operationId) headers.set("idempotency-key", operationId);
  let body: string | undefined;
  if (route.method === "GET") {
    for (const [key, value] of Object.entries(input))
      if (!pathParams.has(key) && value !== undefined)
        url.searchParams.set(key, String(value));
  } else {
    headers.set("content-type", "application/json");
    body = JSON.stringify(
      Object.fromEntries(
        Object.entries(input).filter(([key]) => !pathParams.has(key)),
      ),
    );
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: route.method,
      headers,
      ...(body ? { body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return new ApiFailure(
      0,
      "NETWORK_ERROR",
      route.idempotent
        ? "网络中断，操作结果未知；请查询原操作"
        : "网络请求失败，请检查网络后重试",
      true,
      operationId,
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = standardErrorSchema.safeParse(payload);
    if (!parsed.success)
      return new ApiFailure(
        response.status,
        "RESPONSE_INVALID",
        "服务响应格式无效",
        true,
        operationId,
      );
    return new ApiFailure(
      response.status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.retryable,
      parsed.data.operation_id,
    );
  }
  try {
    const parsed = parseRouteResult(routeId, payload);
    if ("rawResponse" in route && route.rawResponse)
      return {
        data: parsed as RouteOutput<Id>,
        requestId: response.headers.get("x-request-id") ?? "",
        operationId: null,
        status: response.status,
      };
    const envelope = parsed as {
      data: RouteOutput<Id>;
      request_id: string;
      operation_id: string | null;
    };
    return {
      data: envelope.data,
      requestId: envelope.request_id,
      operationId: envelope.operation_id,
      status: response.status,
    };
  } catch {
    return new ApiFailure(
      response.status,
      "RESPONSE_INVALID",
      "服务响应未通过契约校验",
      true,
      operationId,
    );
  }
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
    const result = await send(
      "identity.authenticate",
      { init_data: initData },
      { recoverSession: false },
    );
    if (result instanceof ApiFailure) throw result;
    replaceSession({
      token: result.data.access_token,
      userId: result.data.user_id,
      accountStatus: result.data.account_status,
      expiresAt: result.data.expires_at,
      generation: crypto.randomUUID(),
    });
    clearSessionCache();
  })().finally(() => {
    recovery = null;
  });
  return recovery;
}

function markSessionRecovering(): void {
  const session = getSession();
  if (session) replaceSession({ ...session, recovering: true });
  clearSessionCache();
}

function clearSession(): void {
  replaceSession(null);
  clearSessionCache();
}
