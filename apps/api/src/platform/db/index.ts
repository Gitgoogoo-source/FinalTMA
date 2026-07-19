import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { errorDefinition, isErrorCode } from "@pokepets/api-contracts";

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
    if (error.code === "P0001") {
      const detail = parseDetail(error.details);
      if (detail && isErrorCode(detail.code)) {
        const definition = errorDefinition(detail.code);
        throw new ApiError(
          definition.status,
          detail.code,
          definition.message,
          definition.retryable,
          { database_message: detail.message },
        );
      }
    }
    throw new ApiError(500, "DATABASE_RPC_FAILED", "数据库操作失败", false, {
      name,
      code: error.code,
      message: error.message,
    });
  }
  return data as T;
}

function parseDetail(
  value: string | undefined,
): { code: string; message: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { code?: unknown; message?: unknown };
    return typeof parsed.code === "string" && typeof parsed.message === "string"
      ? { code: parsed.code, message: parsed.message }
      : null;
  } catch {
    return null;
  }
}
