// packages/server/src/db/rpc.ts

import type { Database } from "./database.js";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "./supabaseAdmin.js";

/**
 * RPC 调用封装
 *
 * 责任：
 * 1. 统一调用 Supabase Postgres RPC。
 * 2. 提供类型推导：函数名、参数、返回值。
 * 3. 统一错误格式。
 * 4. 支持 timeout。
 * 5. 支持日志脱敏。
 * 6. 支持自定义 schema。
 *
 * 使用原则：
 * - 所有核心写操作都应该走 RPC。
 * - RPC 内部必须做事务、锁、幂等、余额校验、库存校验。
 * - API 层不能相信前端传来的 user_id。
 * - API 层应该从 session 取 user_id，再作为 RPC 参数传入。
 */

type PublicFunctions = Database["public"]["Functions"];

export type RpcFunctionName = Extract<keyof PublicFunctions, string>;

export type RpcSchemaName = Extract<keyof Database, string>;

export type RpcArgs<TName extends RpcFunctionName> =
  PublicFunctions[TName] extends { Args: infer TArgs } ? TArgs : never;

export type RpcReturns<TName extends RpcFunctionName> =
  PublicFunctions[TName] extends { Returns: infer TReturns } ? TReturns : never;

export type RpcCountOption = "exact" | "planned" | "estimated";

export type RpcArgsObject = Record<string, unknown>;

export type RpcResult<TData> = {
  data: TData;
  count: number | null;
  status?: number | undefined;
  statusText?: string | undefined;
};

export type RpcCallOptions = {
  /**
   * 默认使用 getSupabaseAdminClient()。
   * 测试时可以传入 mock client 或独立 client。
   */
  client?: SupabaseAdminClient;

  /**
   * 默认 public。
   * 如果你的 RPC 放在自定义 schema，需要：
   * 1. Supabase API 设置里暴露该 schema；
   * 2. 调用时传 schema。
   */
  schema?: RpcSchemaName;

  /**
   * 请求超时时间。
   * 默认读取 SUPABASE_RPC_TIMEOUT_MS。
   * 如果环境变量未设置，默认 15000ms。
   * 设置为 0 或负数表示不启用 timeout。
   */
  timeoutMs?: number;

  /**
   * 外部传入 AbortSignal。
   * 例如 API route 被取消时中止数据库请求。
   */
  signal?: AbortSignal;

  /**
   * Supabase rpc options。
   */
  head?: boolean;
  get?: boolean;
  count?: RpcCountOption;

  /**
   * 是否打印 RPC 日志。
   * 默认由 LOG_RPC=1 控制。
   */
  log?: boolean;

  /**
   * 日志里是否脱敏 args。
   * 默认 true。
   */
  redactArgs?: boolean;

  /**
   * 额外上下文，只用于日志和错误对象。
   * 例如 requestId、userId、idempotencyKey。
   */
  context?: Record<string, unknown>;
};

export type SupabaseRpcErrorPayload = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

type RpcQuery<TResult> = PromiseLike<{
  data: TResult | null;
  error: SupabaseRpcErrorPayload | null;
  count?: number | null;
  status?: number;
  statusText?: string;
}> & {
  abortSignal?: (signal: AbortSignal) => RpcQuery<TResult>;
};

type RpcInvoker = {
  rpc: <TResult>(
    rpcName: string,
    args: RpcArgsObject,
    options: {
      head?: boolean | undefined;
      get?: boolean | undefined;
      count?: RpcCountOption | undefined;
    },
  ) => RpcQuery<TResult>;
  schema: (schema: string) => RpcInvoker;
};

type RpcErrorConstructorParams = {
  rpcName: string;
  error?: SupabaseRpcErrorPayload | null;
  cause?: unknown;
  status?: number | undefined;
  statusText?: string | undefined;
  args?: unknown;
  context?: Record<string, unknown> | undefined;
};

export class RpcError extends Error {
  public readonly rpcName: string;
  public readonly code: string | null | undefined;
  public readonly details: string | null | undefined;
  public readonly hint: string | null | undefined;
  public readonly status: number | undefined;
  public readonly statusText: string | undefined;
  public readonly args?: unknown;
  public readonly context: Record<string, unknown> | undefined;
  public readonly cause: unknown;

  constructor(params: RpcErrorConstructorParams) {
    const message =
      params.error?.message ??
      (params.cause instanceof Error
        ? params.cause.message
        : "Unknown Supabase RPC error");

    super(`Supabase RPC "${params.rpcName}" failed: ${message}`);

    this.name = "RpcError";
    this.rpcName = params.rpcName;
    this.code = params.error?.code;
    this.details = params.error?.details;
    this.hint = params.error?.hint;
    this.status = params.status;
    this.statusText = params.statusText;
    this.args = params.args;
    this.context = params.context;
    this.cause = params.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      rpcName: this.rpcName,
      code: this.code,
      details: this.details,
      hint: this.hint,
      status: this.status,
      statusText: this.statusText,
      args: this.args,
      context: this.context,
    };
  }
}

const DEFAULT_RPC_TIMEOUT_MS = 15_000;

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|token|secret|service_role|authorization|api_?key|signature|init_?data|proof|payload|charge_?id|hash|private|mnemonic|seed)/i;

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function getEffectiveTimeoutMs(timeoutMs?: number): number | undefined {
  if (typeof timeoutMs === "number") {
    return timeoutMs > 0 ? timeoutMs : undefined;
  }

  return (
    parsePositiveInteger(process.env.SUPABASE_RPC_TIMEOUT_MS) ??
    DEFAULT_RPC_TIMEOUT_MS
  );
}

function shouldLogRpc(options: RpcCallOptions): boolean {
  if (typeof options.log === "boolean") {
    return options.log;
  }

  return process.env.LOG_RPC === "1";
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return "[MaxDepth]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, itemValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeForLog(itemValue, depth + 1);
      }
    }

    return output;
  }

  return "[UnsupportedValue]";
}

function getLogArgs(args: unknown, options: RpcCallOptions): unknown {
  if (options.redactArgs === false) {
    return args;
  }

  return sanitizeForLog(args);
}

function createAbortSignal(options: RpcCallOptions): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const timeoutMs = getEffectiveTimeoutMs(options.timeoutMs);
  const externalSignal = options.signal;

  if (!timeoutMs && !externalSignal) {
    return {
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const abortFromExternalSignal = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternalSignal, {
        once: true,
      });
    }
  }

  if (timeoutMs) {
    timeoutHandle = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternalSignal);
      }
    },
  };
}

function attachAbortSignal<TQuery>(
  query: TQuery,
  signal?: AbortSignal,
): TQuery {
  if (!signal) {
    return query;
  }

  const queryWithPossibleAbort = query as TQuery & {
    abortSignal?: (signal: AbortSignal) => TQuery;
  };

  if (typeof queryWithPossibleAbort.abortSignal === "function") {
    return queryWithPossibleAbort.abortSignal(signal);
  }

  return query;
}

function logRpcStart(
  rpcName: string,
  args: unknown,
  options: RpcCallOptions,
): void {
  if (!shouldLogRpc(options)) {
    return;
  }

  console.info("[supabase-rpc:start]", {
    rpcName,
    schema: options.schema ?? "public",
    args,
    context: sanitizeForLog(options.context),
  });
}

function logRpcSuccess(
  rpcName: string,
  startedAt: number,
  result: Pick<RpcResult<unknown>, "count" | "status" | "statusText">,
  options: RpcCallOptions,
): void {
  if (!shouldLogRpc(options)) {
    return;
  }

  console.info("[supabase-rpc:success]", {
    rpcName,
    schema: options.schema ?? "public",
    durationMs: Date.now() - startedAt,
    count: result.count,
    status: result.status,
    statusText: result.statusText,
    context: sanitizeForLog(options.context),
  });
}

function logRpcError(
  error: RpcError,
  startedAt: number,
  options: RpcCallOptions,
): void {
  if (!shouldLogRpc(options)) {
    return;
  }

  console.error("[supabase-rpc:error]", {
    ...error.toJSON(),
    durationMs: Date.now() - startedAt,
  });
}

async function executeRpc<TResult>(
  rpcName: string,
  args: RpcArgsObject | undefined,
  options: RpcCallOptions = {},
): Promise<RpcResult<TResult>> {
  const client = options.client ?? getSupabaseAdminClient();
  const effectiveArgs = args ?? {};
  const safeArgs = getLogArgs(effectiveArgs, options);
  const startedAt = Date.now();

  const { signal, cleanup } = createAbortSignal(options);

  logRpcStart(rpcName, safeArgs, options);

  try {
    /**
     * Supabase 默认 RPC schema 是 public。
     * 如果使用自定义 schema，例如 "private_rpc"、"internal"，
     * 可以传 options.schema。
     */
    const baseClient = client as unknown as RpcInvoker;
    const rpcClient =
      options.schema && options.schema !== "public"
        ? baseClient.schema(options.schema)
        : baseClient;

    const query = rpcClient.rpc<TResult>(rpcName, effectiveArgs, {
      head: options.head,
      get: options.get,
      count: options.count,
    });

    const queryWithAbortSignal = attachAbortSignal(query, signal);

    const response = await queryWithAbortSignal;

    const data = response.data as TResult;
    const count = response.count ?? null;
    const status = response.status;
    const statusText = response.statusText;

    if (response.error) {
      const rpcError = new RpcError({
        rpcName,
        error: response.error,
        status,
        statusText,
        args: safeArgs,
        context: sanitizeForLog(options.context) as Record<string, unknown>,
      });

      logRpcError(rpcError, startedAt, options);

      throw rpcError;
    }

    const result: RpcResult<TResult> = {
      data,
      count,
      status,
      statusText,
    };

    logRpcSuccess(rpcName, startedAt, result, options);

    return result;
  } catch (cause) {
    if (cause instanceof RpcError) {
      throw cause;
    }

    const rpcError = new RpcError({
      rpcName,
      cause,
      args: safeArgs,
      context: sanitizeForLog(options.context) as Record<string, unknown>,
    });

    logRpcError(rpcError, startedAt, options);

    throw rpcError;
  } finally {
    cleanup();
  }
}

/**
 * 强类型 RPC 调用。
 *
 * 要求：
 * - 你的 Supabase database.types.ts 里已经生成了对应函数类型。
 * - RPC 函数在 Database["public"]["Functions"] 中。
 *
 * 示例：
 *   const result = await callRpc("gacha_create_order", {
 *     p_user_id: userId,
 *     p_box_id: boxId,
 *     p_quantity: 10,
 *     p_idempotency_key: idempotencyKey,
 *   });
 */
export async function callRpc<TName extends RpcFunctionName>(
  rpcName: TName,
  args: RpcArgs<TName>,
  options: RpcCallOptions = {},
): Promise<RpcReturns<TName>> {
  const result = await callRpcWithMeta(rpcName, args, options);

  return result.data;
}

/**
 * 强类型 RPC 调用，返回 meta 信息。
 *
 * 适合：
 * - 需要 status/statusText。
 * - 需要 count。
 * - 需要调试 RPC 返回状态。
 */
export async function callRpcWithMeta<TName extends RpcFunctionName>(
  rpcName: TName,
  args: RpcArgs<TName>,
  options: RpcCallOptions = {},
): Promise<RpcResult<RpcReturns<TName>>> {
  return executeRpc<RpcReturns<TName>>(
    rpcName,
    args as unknown as RpcArgsObject,
    options,
  );
}

/**
 * 非强类型 RPC 调用。
 *
 * 适合：
 * - migration 还没生成 database.types.ts。
 * - RPC 在自定义 schema。
 * - 临时脚本。
 *
 * 示例：
 *   const result = await callRpcRaw<{ order_id: string }>(
 *     "gacha_create_order",
 *     { p_user_id: userId, p_box_id: boxId },
 *   );
 */
export async function callRpcRaw<
  TResult = unknown,
  TArgs extends RpcArgsObject = RpcArgsObject,
>(
  rpcName: string,
  args: TArgs = {} as TArgs,
  options: RpcCallOptions = {},
): Promise<TResult> {
  const result = await callRpcRawWithMeta<TResult, TArgs>(
    rpcName,
    args,
    options,
  );

  return result.data;
}

/**
 * 非强类型 RPC 调用，返回 meta 信息。
 */
export async function callRpcRawWithMeta<
  TResult = unknown,
  TArgs extends RpcArgsObject = RpcArgsObject,
>(
  rpcName: string,
  args: TArgs = {} as TArgs,
  options: RpcCallOptions = {},
): Promise<RpcResult<TResult>> {
  return executeRpc<TResult>(rpcName, args, options);
}

/**
 * 语义化别名。
 * API 文件里可以这样写：
 *
 *   import { rpc } from "@tma-game/server/db/rpc";
 *
 *   const data = await rpc("market_buy_listing", {
 *     p_buyer_user_id: userId,
 *     p_listing_id: listingId,
 *     p_idempotency_key: idempotencyKey,
 *   });
 */
export const rpc = callRpc;

/**
 * 非类型化别名。
 */
export const rpcRaw = callRpcRaw;
