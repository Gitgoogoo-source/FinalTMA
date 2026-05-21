// packages/server/src/db/supabaseAdmin.ts

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.js";

/**
 * Supabase Admin Client
 *
 * 责任：
 * 1. 只在服务端创建 Supabase client。
 * 2. 使用 SUPABASE_SECRET_KEY 或 SUPABASE_SERVICE_ROLE_KEY。
 * 3. 禁止浏览器端导入。
 * 4. 禁用前端 session 持久化，避免把用户 session 混入 admin client。
 * 5. 给 Vercel API / server package 提供统一 Supabase admin 入口。
 *
 * 严禁：
 * - 在 apps/web 中导入这个文件。
 * - 在前端暴露 SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY。
 * - 用这个 client 直接相信前端传来的 user_id。
 */

export type SupabaseAdminClient = SupabaseClient<Database>;

export type SupabaseAdminConfig = Readonly<{
  supabaseUrl: string;
  supabaseKey: string;
  keySource: "SUPABASE_SECRET_KEY" | "SUPABASE_SERVICE_ROLE_KEY";
  clientInfo: string;
}>;

export type CreateSupabaseAdminClientOptions = Partial<
  Pick<SupabaseAdminConfig, "supabaseUrl" | "supabaseKey" | "clientInfo">
>;

const DEFAULT_CLIENT_INFO = "tma-game-server/1.0.0";

let cachedClient: SupabaseAdminClient | null = null;

function assertServerOnly(): void {
  const runningInBrowser =
    typeof globalThis !== "undefined" && "window" in globalThis;

  if (runningInBrowser) {
    throw new Error(
      [
        "supabaseAdmin.ts was imported in browser/client code.",
        "This file uses a Supabase secret/service-role key and must only be used in:",
        "- packages/server",
        "- api/* Vercel Functions",
        "- server-side scripts",
      ].join(" "),
    );
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function assertValidSupabaseUrl(value: string): void {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `Invalid SUPABASE_URL. Expected a valid URL, received: ${value}`,
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Invalid SUPABASE_URL protocol. Expected http or https, received: ${parsed.protocol}`,
    );
  }
}

export function readSupabaseAdminConfig(): SupabaseAdminConfig {
  assertServerOnly();

  const supabaseUrl = readEnv("SUPABASE_URL");

  if (!supabaseUrl) {
    throw new Error(
      "Missing SUPABASE_URL. Add it to your Vercel environment variables or local .env file.",
    );
  }

  assertValidSupabaseUrl(supabaseUrl);

  const secretKey = readEnv("SUPABASE_SECRET_KEY");
  const legacyServiceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabaseKey = secretKey ?? legacyServiceRoleKey;
  const keySource = secretKey
    ? "SUPABASE_SECRET_KEY"
    : "SUPABASE_SERVICE_ROLE_KEY";

  if (!supabaseKey) {
    throw new Error(
      [
        "Missing Supabase server key.",
        "Set SUPABASE_SECRET_KEY for new Supabase secret keys,",
        "or SUPABASE_SERVICE_ROLE_KEY for legacy service-role projects.",
      ].join(" "),
    );
  }

  const clientInfo = readEnv("SUPABASE_CLIENT_INFO") ?? DEFAULT_CLIENT_INFO;

  return {
    supabaseUrl,
    supabaseKey,
    keySource,
    clientInfo,
  };
}

export function createSupabaseAdminClient(
  options: CreateSupabaseAdminClientOptions = {},
): SupabaseAdminClient {
  assertServerOnly();

  const envConfig = readSupabaseAdminConfig();

  const supabaseUrl = options.supabaseUrl ?? envConfig.supabaseUrl;
  const supabaseKey = options.supabaseKey ?? envConfig.supabaseKey;
  const clientInfo = options.clientInfo ?? envConfig.clientInfo;

  /**
   * 重要配置说明：
   *
   * autoRefreshToken: false
   * - admin client 不应该刷新用户 token。
   *
   * persistSession: false
   * - 服务端不需要 localStorage / cookie 持久化 Supabase Auth session。
   *
   * detectSessionInUrl: false
   * - 服务端不处理 URL 中的 auth session。
   *
   * 这个 client 是“服务端管理员 client”，不是“用户 client”。
   * 用户权限应该由 API session + RPC 内部参数校验完成。
   */
  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": clientInfo,
      },
    },
  });
}

export function getSupabaseAdminClient(): SupabaseAdminClient {
  if (!cachedClient) {
    cachedClient = createSupabaseAdminClient();
  }

  return cachedClient;
}

/**
 * 兼容两种使用方式：
 *
 * 推荐：
 *   const supabase = getSupabaseAdminClient();
 *
 * 也可以：
 *   import { supabaseAdmin } from "./supabaseAdmin.js";
 *   await supabaseAdmin.rpc(...)
 *
 * 这里用 Proxy 做 lazy 初始化，避免测试环境 import 文件时立即读取 env。
 */
export const supabaseAdmin: SupabaseAdminClient = new Proxy(
  {} as SupabaseAdminClient,
  {
    get(_target, property) {
      const client = getSupabaseAdminClient();
      const value = (client as unknown as Record<PropertyKey, unknown>)[
        property
      ];

      if (typeof value === "function") {
        return value.bind(client);
      }

      return value;
    },
  },
);

/**
 * 仅测试环境使用。
 * 不允许业务代码调用。
 */
export function resetSupabaseAdminClientForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "resetSupabaseAdminClientForTests() can only be used when NODE_ENV=test.",
    );
  }

  cachedClient = null;
}
