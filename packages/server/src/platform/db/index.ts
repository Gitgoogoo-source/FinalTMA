import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "../../http/errors.ts";
import { getEnv } from "../env/index.ts";

let client: SupabaseClient | undefined;

function db(): SupabaseClient {
  if (!client) {
    const env = getEnv();
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { "X-Client-Info": "pokepets-server/1.0" } },
    });
  }
  return client;
}

export async function rpc<T>(
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db().schema("api").rpc(name, parameters);
  if (error) {
    const match = /^([A-Z][A-Z0-9_]+):(.+)$/.exec(error.message);
    if (match) {
      const [, code, message] = match;
      if (code && message) throw new ApiError(statusFor(code), code, message);
    }
    throw new ApiError(500, "DATABASE_RPC_FAILED", "数据库操作失败", false, {
      name,
      code: error.code,
      message: error.message,
    });
  }
  return data as T;
}

function statusFor(code: string): number {
  if (code === "RATE_LIMITED") return 429;
  if (code.startsWith("SESSION_")) return 401;
  if (code === "ACCOUNT_RESTRICTED") return 403;
  return 409;
}
