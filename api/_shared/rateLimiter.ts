import { getSupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import {
  createRateLimiter,
  type CreateRateLimiterOptions,
  type RateLimiter,
} from "../../packages/server/src/security/rateLimit.js";

type ApiRateLimiterOptions = Omit<
  CreateRateLimiterOptions,
  "supabase" | "rpcName" | "rpcSchema" | "failOpen"
>;

const RATE_LIMIT_RPC_NAME = "ops_check_rate_limit";
const RATE_LIMIT_RPC_SCHEMA = "api";

export function createApiRateLimiter(
  options: ApiRateLimiterOptions = {},
): RateLimiter {
  if (shouldUseMemoryRateLimitStore()) {
    return createRateLimiter(options);
  }

  return createRateLimiter({
    ...options,
    supabase: getSupabaseAdminClient(),
    rpcName: RATE_LIMIT_RPC_NAME,
    rpcSchema: RATE_LIMIT_RPC_SCHEMA,
    failOpen: shouldFailOpenRateLimit(),
  });
}

function shouldUseMemoryRateLimitStore(): boolean {
  const storage = process.env.RATE_LIMIT_STORAGE?.trim().toLowerCase();

  return process.env.NODE_ENV === "test" || storage === "memory";
}

function shouldFailOpenRateLimit(): boolean {
  const value = process.env.RATE_LIMIT_FAIL_OPEN?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}
