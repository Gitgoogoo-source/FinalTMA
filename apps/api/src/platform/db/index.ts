import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { errorDefinition, isErrorCode } from "@pokepets/api-contracts/common";

import { ApiError } from "../../http/errors.ts";
import { getDatabaseEnv } from "../env/index.ts";
import {
  observeRequestStage,
  type RequestTelemetry,
} from "../observability/index.ts";

let client: SupabaseClient | undefined;

function db(): SupabaseClient {
  if (!client) {
    const env = getDatabaseEnv();
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

export async function removeStorageObjects(
  bucket: string,
  objectKeys: readonly string[],
): Promise<void> {
  if (objectKeys.length === 0) return;
  const { error } = await db()
    .storage.from(bucket)
    .remove([...objectKeys]);
  if (error)
    throw new ApiError(500, "DATABASE_RPC_FAILED", "资源清理失败", false, {
      bucket,
      count: objectKeys.length,
      code: error.name,
    });
}

export async function rpc<T>(
  name: string,
  parameters: Record<string, unknown>,
  options: {
    signal?: AbortSignal | undefined;
    telemetry?: RequestTelemetry | null | undefined;
  } = {},
): Promise<T> {
  const request = db().schema("api").rpc(name, parameters);
  return observeRequestStage(options.telemetry, "db_rpc", async () => {
    const { data, error } = await (options.signal
      ? request.abortSignal(options.signal)
      : request);
    if (error) {
      if (options.signal?.aborted)
        throw (
          options.signal.reason ??
          new DOMException("Request aborted", "AbortError")
        );
      if (error.code === "P0001") {
        const detail = parseDetail(error.details);
        if (detail && isErrorCode(detail.code)) {
          const definition = errorDefinition(detail.code);
          throw new ApiError(
            definition.status,
            detail.code,
            definition.message,
            definition.retryable,
          );
        }
      }
      throw new ApiError(500, "DATABASE_RPC_FAILED", "数据库操作失败", false, {
        name,
        code: error.code,
      });
    }
    return data as T;
  });
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
