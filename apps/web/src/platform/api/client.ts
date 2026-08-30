import {
  parseRouteResult,
  loadClientRoute,
  standardErrorSchema,
  type RouteId,
  type RouteInput,
  type RouteOutput,
} from "@evomypet/api-contracts/app-client";

import {
  clearSensitiveState,
  getSession,
  replaceSession,
  seedSessionInitialState,
  transitionToBanned,
} from "../session/store.ts";
import { getWebPublicConfig } from "../env/index.ts";
import {
  apiErrorMessage,
  synchronizeAccountLanguage,
  t,
} from "../i18n/index.ts";
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
  keepalive?: boolean;
};
let recovery: Promise<void> | null = null;

class SessionInitialStateFailure extends Error {
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
  const route = await loadClientRoute(routeId).catch(() => {
    throw new ApiFailure(
      0,
      "CLIENT_CONTRACT_LOAD_FAILED",
      t("功能资源暂时无法加载，请重试"),
      true,
      null,
    );
  });
  const authenticated = route.auth;
  const parsedInput = route.input.parse(input) as Record<string, unknown>;
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
    try {
      if (recovery) {
        await recovery;
        return apiRequest(routeId, input, {
          ...options,
          recoverSession: false,
        });
      }
      if (
        requestGeneration &&
        getSession()?.generation !== requestGeneration &&
        getSession()?.accountStatus === "normal"
      )
        return apiRequest(routeId, input, {
          ...options,
          recoverSession: false,
        });
      markSessionRecovering();
      await recoverSession();
      return apiRequest(routeId, input, { ...options, recoverSession: false });
    } catch (cause) {
      if (cause instanceof SessionInitialStateFailure) throw cause.failure;
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
  if (authenticated) assertCurrentNormalSession(requestGeneration);
  return result;
}

export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function resetSessionRecovery(): void {
  recovery = null;
}

export async function apiKeepaliveRequest<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id>,
): Promise<ApiResult<RouteOutput<Id>>> {
  const route = await loadClientRoute(routeId);
  if (route.method === "GET" || route.idempotent)
    throw new Error(
      `Keepalive is only available for semantic commands: ${routeId}`,
    );
  return apiRequest(routeId, input, {
    keepalive: true,
    recoverSession: false,
  });
}

export async function retryRecoveredInitialState(): Promise<void> {
  const session = getSession();
  if (!session || session.accountStatus !== "normal") return;
  replaceSession({ ...session, recovering: true, initialStateFailed: false });
  const result = await send("identity.initial", {}, { recoverSession: false });
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
      replaceSession({
        ...session,
        recovering: false,
        initialStateFailed: true,
      });
    }
    throw result;
  }
  assertCurrentNormalSession(session.generation);
  clearSensitiveState();
  replaceSession({ ...session, recovering: false, initialStateFailed: false });
  seedSessionInitialState(session.generation, result.data);
}

async function send<Id extends RouteId>(
  routeId: Id,
  input: Record<string, unknown>,
  options: Options,
): Promise<ApiResult<RouteOutput<Id>> | ApiFailure> {
  const route = await loadClientRoute(routeId);
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
      ...(options.keepalive ? { keepalive: true } : {}),
    });
  } catch {
    if (options.signal?.aborted)
      throw (
        options.signal.reason ??
        new DOMException("Request aborted", "AbortError")
      );
    return new ApiFailure(
      0,
      "NETWORK_ERROR",
      route.idempotent
        ? t("网络中断，结果仍在确认，请勿重复操作")
        : t("网络异常，请稍后重试"),
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
        t("收到的结果暂时无法确认"),
        true,
        operationId,
      );
    return new ApiFailure(
      response.status,
      parsed.data.error.code,
      apiErrorMessage(parsed.data.error.code, parsed.data.error.message),
      parsed.data.error.retryable,
      parsed.data.operation_id,
    );
  }
  try {
    const parsed = await parseRouteResult(routeId, payload);
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
      t("收到的结果暂时无法确认"),
      true,
      operationId,
    );
  }
}

async function recoverSession(): Promise<void> {
  const expiredGeneration = getSession()?.generation;
  recovery ??= (async () => {
    const initData = telegram()?.initData;
    if (!initData)
      throw new ApiFailure(
        401,
        "TELEGRAM_REENTRY_REQUIRED",
        t("请从 Telegram Mini App 重新打开应用"),
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
        t("账户当前不可执行此操作"),
        false,
        null,
      );
    }
    if (getSession()?.generation !== expiredGeneration)
      throw new ApiFailure(
        401,
        "TELEGRAM_REENTRY_REQUIRED",
        t("请从 Telegram Mini App 重新打开应用"),
        false,
        null,
      );
    const next = {
      token: result.data.access_token,
      userId: result.data.user_id,
      accountStatus: result.data.account_status,
      expiresAt: result.data.expires_at,
      generation: crypto.randomUUID(),
      entryKind: result.data.entry_kind,
      entryHandoffState: result.data.entry_handoff_state,
      entryHandoffCode: result.data.entry_handoff_code,
      entryHandoffResult: result.data.entry_handoff_result,
      preferredLanguage: result.data.preferred_language,
      recovering: true,
    } as const;
    synchronizeAccountLanguage(result.data.preferred_language);
    replaceSession(next);
    if (next.entryHandoffState === "pending")
      throw new ApiFailure(
        409,
        "ENTRY_HANDOFF_PENDING",
        t("邀请绑定结果确认中，请稍后刷新"),
        true,
        null,
      );
    const initialState = result.data.initial_state
      ? { data: result.data.initial_state }
      : await send("identity.initial", {}, { recoverSession: false });
    if (initialState instanceof ApiFailure) {
      if (initialState.code === "ACCOUNT_RESTRICTED") {
        transitionToBanned();
        throw initialState;
      }
      if (
        ["SESSION_EXPIRED", "SESSION_REPLACED", "SESSION_REQUIRED"].includes(
          initialState.code,
        )
      ) {
        clearSession();
        throw initialState;
      }
      if (initialState.code === "ENTRY_HANDOFF_PENDING") throw initialState;
      clearSensitiveState();
      replaceSession({ ...next, recovering: false, initialStateFailed: true });
      throw new SessionInitialStateFailure(initialState);
    }
    assertCurrentNormalSession(next.generation);
    clearSensitiveState();
    seedSessionInitialState(next.generation, initialState.data);
    replaceSession({ ...next, recovering: false, initialStateFailed: false });
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
