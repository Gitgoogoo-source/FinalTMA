import {
  parseRouteInput,
  parseRouteResult,
  routeById,
  standardErrorSchema,
  type RouteId,
  type RouteInput,
  type RouteOutput,
} from "@pokepets/api-contracts/app";

import {
  clearSensitiveState,
  getSession,
  replaceSession,
  seedSessionBootstrap,
  transitionToBanned,
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

class SessionBootstrapFailure extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

export async function apiRequest<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id>,
  options: Options = {},
): Promise<ApiResult<RouteOutput<Id>>> {
  const requestGeneration = getSession()?.generation;
  const parsedInput = parseRouteInput(routeId, input) as Record<
    string,
    unknown
  >;
  const result = await send(routeId, parsedInput, options);
  if (result instanceof ApiFailure && result.code === "ACCOUNT_RESTRICTED") {
    transitionToBanned();
  }
  if (
    result instanceof ApiFailure &&
    result.code === "SESSION_EXPIRED" &&
    options.recoverSession !== false &&
    routeId !== "identity.authenticate"
  ) {
    if (getSession()?.accountStatus !== "normal") throw result;
    if (
      requestGeneration &&
      getSession()?.generation !== requestGeneration &&
      getSession()?.accountStatus === "normal"
    )
      return apiRequest(routeId, input, { ...options, recoverSession: false });
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
      if (cause instanceof SessionBootstrapFailure) throw cause.failure;
      if (
        !(
          cause instanceof ApiFailure &&
          ["ACCOUNT_RESTRICTED", "ENTRY_HANDOFF_PENDING"].includes(cause.code)
        )
      )
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
  if (routeById(routeId).auth) assertCurrentNormalSession(requestGeneration);
  return result;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function resetSessionRecovery(): void {
  recoveryAttempted = false;
  recovery = null;
}

export async function retryRecoveredBootstrap(): Promise<void> {
  const session = getSession();
  if (!session || session.accountStatus !== "normal") return;
  replaceSession({ ...session, recovering: true, bootstrapFailed: false });
  const result = await send(
    "identity.bootstrap",
    {},
    { recoverSession: false },
  );
  if (result instanceof ApiFailure) {
    if (result.code === "ACCOUNT_RESTRICTED") {
      transitionToBanned();
    } else if (
      ["SESSION_EXPIRED", "SESSION_REPLACED", "SESSION_REQUIRED"].includes(
        result.code,
      )
    ) {
      clearSession();
    } else {
      replaceSession({ ...session, recovering: false, bootstrapFailed: true });
    }
    throw result;
  }
  assertCurrentNormalSession(session.generation);
  clearSensitiveState();
  replaceSession({ ...session, recovering: false, bootstrapFailed: false });
  seedSessionBootstrap(session.generation, result.data);
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
  const expiredGeneration = getSession()?.generation;
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
      {
        recoverSession: false,
        idempotencyKey: newIdempotencyKey(),
      },
    );
    if (result instanceof ApiFailure) throw result;
    if (result.data.account_status === "banned") {
      transitionToBanned();
      throw new ApiFailure(
        403,
        "ACCOUNT_RESTRICTED",
        "账户当前不可执行此操作",
        false,
        null,
      );
    }
    if (getSession()?.generation !== expiredGeneration)
      throw new ApiFailure(
        401,
        "TELEGRAM_REENTRY_REQUIRED",
        "请从 Telegram Mini App 重新打开应用",
        false,
        null,
      );
    const next = {
      token: result.data.access_token,
      userId: result.data.user_id,
      accountStatus: result.data.account_status,
      expiresAt: result.data.expires_at,
      generation: crypto.randomUUID(),
      entryHandoffState: result.data.entry_handoff_state,
      entryHandoffCode: result.data.entry_handoff_code,
      entryHandoffResult: result.data.entry_handoff_result,
      recovering: true,
    } as const;
    replaceSession(next);
    if (next.entryHandoffState === "pending")
      throw new ApiFailure(
        409,
        "ENTRY_HANDOFF_PENDING",
        "邀请绑定结果确认中，请稍后刷新",
        true,
        null,
      );
    const bootstrap = await send(
      "identity.bootstrap",
      {},
      { recoverSession: false },
    );
    if (bootstrap instanceof ApiFailure) {
      if (bootstrap.code === "ACCOUNT_RESTRICTED") {
        transitionToBanned();
        throw bootstrap;
      }
      clearSensitiveState();
      replaceSession({ ...next, recovering: false, bootstrapFailed: true });
      throw new SessionBootstrapFailure(bootstrap);
    }
    assertCurrentNormalSession(next.generation);
    clearSensitiveState();
    replaceSession({ ...next, recovering: false, bootstrapFailed: false });
    seedSessionBootstrap(next.generation, bootstrap.data);
  })().finally(() => {
    recovery = null;
  });
  return recovery;
}

function markSessionRecovering(): void {
  const session = getSession();
  if (session)
    replaceSession({
      ...session,
      generation: crypto.randomUUID(),
      recovering: true,
    });
  clearSensitiveState();
}

function clearSession(): void {
  replaceSession(null);
  clearSensitiveState();
}

function assertCurrentNormalSession(
  expectedGeneration: string | undefined,
): void {
  const session = getSession();
  if (
    !expectedGeneration ||
    session?.generation !== expectedGeneration ||
    session.accountStatus !== "normal"
  )
    throw new DOMException("Stale session generation", "AbortError");
}
