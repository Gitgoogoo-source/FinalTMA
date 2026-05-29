/* packages/server/src/security/rateLimit.ts */

import { createHash, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitStorageName = "memory" | "supabase-rpc" | "none";

export type RateLimitScope =
  | "global"
  | "ip"
  | "user"
  | "session"
  | "telegram_user"
  | "wallet"
  | "custom";

export type RateLimitAction =
  | "*"
  | "auth.telegram"
  | "auth.refresh"
  | "me.bootstrap"
  | "box.list"
  | "box.rewards"
  | "box.create_open_order"
  | "box.result"
  | "box.history"
  | "telegram.webhook"
  | "telegram.share"
  | "market.listings"
  | "market.listing_detail"
  | "market.buy"
  | "market.sellable_items"
  | "market.create_listing"
  | "market.my_listings"
  | "market.update_price"
  | "market.cancel_listing"
  | "inventory.list"
  | "inventory.detail"
  | "inventory.upgrade"
  | "inventory.evolve"
  | "inventory.decompose"
  | "inventory.activity"
  | "album.progress"
  | "album.claim_reward"
  | "album.leaderboard"
  | "tasks.list"
  | "tasks.claim"
  | "tasks.check_in"
  | "tasks.invite_stats"
  | "tasks.referral_link"
  | "wallet.connect"
  | "wallet.proof"
  | "wallet.sync_nfts"
  | "wallet.mint"
  | "wallet.mint_status"
  | "admin.read"
  | "admin.write"
  | "cron.job"
  | (string & {});

export type HeaderValue = string | string[] | number | undefined | null;

export type HeaderLike =
  | {
      get(name: string): string | null;
    }
  | Record<string, HeaderValue>;

export interface RateLimitRule {
  action: RateLimitAction;
  scope: RateLimitScope;
  windowMs: number;
  max: number;
  blockMs?: number | undefined;
  enabled?: boolean | undefined;
  description?: string | undefined;
  keyPrefix?: string | undefined;
  failOpen?: boolean | undefined;
}

export interface RateLimitSubject {
  ip?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
  telegramUserId?: string | number | undefined;
  walletAddress?: string | undefined;
  custom?: string | undefined;
}

export interface RateLimitRequestContext extends RateLimitSubject {
  action: RateLimitAction;
  method?: string | undefined;
  path?: string | undefined;
  headers?: HeaderLike | undefined;
  userAgent?: string | undefined;
  idempotencyKey?: string | undefined;
  now?: Date | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RateLimitStoreConsumeInput {
  key: string;
  action: RateLimitAction;
  scope: RateLimitScope;
  identifierHash: string;
  limit: number;
  windowMs: number;
  blockMs?: number | undefined;
  now: Date;
  metadata?: Record<string, unknown> | undefined;
}

export type RateLimitRejectReason =
  | "disabled"
  | "allowed"
  | "limit_exceeded"
  | "blocked"
  | "store_error"
  | "missing_subject";

export interface RateLimitResult {
  allowed: boolean;
  action: RateLimitAction;
  scope: RateLimitScope;
  key: string;
  storage: RateLimitStorageName;
  limit: number;
  current: number;
  remaining: number;
  windowMs: number;
  resetAt: Date;
  retryAfterMs: number;
  blockedUntil?: Date | undefined;
  reason: RateLimitRejectReason;
  storeError?: string | undefined;
}

export interface RateLimitCombinedResult {
  allowed: boolean;
  action: RateLimitAction;
  results: RateLimitResult[];
  rejected?: RateLimitResult | undefined;
  retryAfterMs: number;
  headers: Record<string, string>;
}

export interface RateLimitStore {
  name: RateLimitStorageName;
  consume(input: RateLimitStoreConsumeInput): Promise<RateLimitResult>;
}

export interface CreateRateLimiterOptions {
  supabase?: SupabaseClient | undefined;
  store?: RateLimitStore | undefined;
  rules?: RateLimitRule[] | undefined;
  extraRules?: RateLimitRule[] | undefined;
  keyPrefix?: string | undefined;
  keySecret?: string | undefined;
  rpcName?: string | undefined;
  failOpen?: boolean | undefined;
}

export interface RateLimiterOptions {
  store: RateLimitStore;
  rules: RateLimitRule[];
  keyPrefix?: string | undefined;
  keySecret?: string | undefined;
}

interface BuiltRateLimitKey {
  key: string;
  identifierHash: string;
  subject: string;
}

interface MemoryBucket {
  count: number;
  windowStartedAtMs: number;
  blockedUntilMs?: number | undefined;
}

const DEFAULT_KEY_PREFIX = "tma_game";

const DEFAULT_WINDOW_MS = 60_000;

const DEFAULT_BLOCK_MS = 60_000;

const SENSITIVE_METADATA_KEYS = new Set([
  "authorization",
  "auth",
  "token",
  "access_token",
  "refresh_token",
  "bot_token",
  "service_role",
  "apikey",
  "api_key",
  "secret",
  "password",
  "private_key",
  "privateKey",
  "initData",
  "init_data",
  "hash",
  "signature",
  "headers",
  "cookie",
  "cookies",
  "ip",
]);

export const DEFAULT_RATE_LIMIT_RULES: RateLimitRule[] = [
  {
    action: "*",
    scope: "ip",
    windowMs: 60_000,
    max: 300,
    blockMs: 60_000,
    description: "Global IP protection for all public API requests.",
  },

  {
    action: "auth.telegram",
    scope: "ip",
    windowMs: 60_000,
    max: 30,
    blockMs: 5 * 60_000,
    description: "Prevent Telegram initData brute-force verification attempts.",
  },
  {
    action: "auth.refresh",
    scope: "session",
    windowMs: 60_000,
    max: 20,
    blockMs: 2 * 60_000,
  },

  {
    action: "box.create_open_order",
    scope: "user",
    windowMs: 60_000,
    max: 12,
    blockMs: 2 * 60_000,
    description: "Limit paid draw order creation per user.",
  },
  {
    action: "box.create_open_order",
    scope: "ip",
    windowMs: 60_000,
    max: 40,
    blockMs: 2 * 60_000,
  },
  {
    action: "box.result",
    scope: "user",
    windowMs: 60_000,
    max: 60,
    blockMs: 60_000,
  },

  {
    action: "telegram.webhook",
    scope: "ip",
    windowMs: 60_000,
    max: 600,
    blockMs: 60_000,
    description:
      "Telegram webhook can burst; keep this higher than normal user APIs.",
  },

  {
    action: "market.buy",
    scope: "user",
    windowMs: 60_000,
    max: 30,
    blockMs: 3 * 60_000,
  },
  {
    action: "market.create_listing",
    scope: "user",
    windowMs: 60_000,
    max: 30,
    blockMs: 3 * 60_000,
  },
  {
    action: "market.update_price",
    scope: "user",
    windowMs: 60_000,
    max: 20,
    blockMs: 3 * 60_000,
  },
  {
    action: "market.cancel_listing",
    scope: "user",
    windowMs: 60_000,
    max: 30,
    blockMs: 3 * 60_000,
  },

  {
    action: "inventory.upgrade",
    scope: "user",
    windowMs: 60_000,
    max: 60,
    blockMs: 2 * 60_000,
  },
  {
    action: "inventory.evolve",
    scope: "user",
    windowMs: 60_000,
    max: 20,
    blockMs: 3 * 60_000,
  },
  {
    action: "inventory.decompose",
    scope: "user",
    windowMs: 60_000,
    max: 40,
    blockMs: 3 * 60_000,
  },
  {
    action: "inventory.activity",
    scope: "user",
    windowMs: 60_000,
    max: 60,
    blockMs: 2 * 60_000,
  },

  {
    action: "tasks.claim",
    scope: "user",
    windowMs: 60_000,
    max: 30,
    blockMs: 2 * 60_000,
  },
  {
    action: "tasks.check_in",
    scope: "user",
    windowMs: 60_000,
    max: 10,
    blockMs: 2 * 60_000,
  },
  {
    action: "tasks.referral_link",
    scope: "user",
    windowMs: 60_000,
    max: 20,
    blockMs: 2 * 60_000,
  },

  {
    action: "wallet.connect",
    scope: "user",
    windowMs: 60_000,
    max: 20,
    blockMs: 2 * 60_000,
  },
  {
    action: "wallet.proof",
    scope: "user",
    windowMs: 60_000,
    max: 20,
    blockMs: 2 * 60_000,
  },
  {
    action: "wallet.sync_nfts",
    scope: "user",
    windowMs: 5 * 60_000,
    max: 12,
    blockMs: 5 * 60_000,
  },
  {
    action: "wallet.mint",
    scope: "user",
    windowMs: 60_000,
    max: 10,
    blockMs: 5 * 60_000,
  },
  {
    action: "wallet.mint_status",
    scope: "user",
    windowMs: 60_000,
    max: 60,
    blockMs: 60_000,
  },

  {
    action: "admin.write",
    scope: "user",
    windowMs: 60_000,
    max: 60,
    blockMs: 5 * 60_000,
  },
  {
    action: "admin.write",
    scope: "ip",
    windowMs: 60_000,
    max: 100,
    blockMs: 5 * 60_000,
  },
];

export class RateLimitError extends Error {
  public readonly statusCode = 429;

  public readonly result: RateLimitCombinedResult;

  public readonly headers: Record<string, string>;

  constructor(
    result: RateLimitCombinedResult,
    message = "请求过于频繁，请稍后再试。",
  ) {
    super(message);
    this.name = "RateLimitError";
    this.result = result;
    this.headers = result.headers;
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  public readonly name = "memory" as const;

  private readonly buckets = new Map<string, MemoryBucket>();

  private operationCount = 0;

  public async consume(
    input: RateLimitStoreConsumeInput,
  ): Promise<RateLimitResult> {
    const nowMs = input.now.getTime();
    const windowMs = input.windowMs || DEFAULT_WINDOW_MS;
    const blockMs = input.blockMs ?? DEFAULT_BLOCK_MS;
    const resetAt = new Date(nowMs + windowMs);

    this.operationCount += 1;
    if (this.operationCount % 1_000 === 0) {
      this.cleanup(nowMs);
    }

    const existing = this.buckets.get(input.key);

    if (existing?.blockedUntilMs && existing.blockedUntilMs > nowMs) {
      const blockedUntil = new Date(existing.blockedUntilMs);
      return {
        allowed: false,
        action: input.action,
        scope: input.scope,
        key: input.key,
        storage: this.name,
        limit: input.limit,
        current: existing.count,
        remaining: 0,
        windowMs,
        resetAt: new Date(existing.windowStartedAtMs + windowMs),
        retryAfterMs: Math.max(0, existing.blockedUntilMs - nowMs),
        blockedUntil,
        reason: "blocked",
      };
    }

    const shouldCreateNewBucket =
      !existing || nowMs - existing.windowStartedAtMs >= windowMs;

    const bucket: MemoryBucket = shouldCreateNewBucket
      ? {
          count: 0,
          windowStartedAtMs: nowMs,
        }
      : existing;

    bucket.count += 1;

    if (bucket.count > input.limit) {
      bucket.blockedUntilMs = nowMs + blockMs;
      this.buckets.set(input.key, bucket);

      return {
        allowed: false,
        action: input.action,
        scope: input.scope,
        key: input.key,
        storage: this.name,
        limit: input.limit,
        current: bucket.count,
        remaining: 0,
        windowMs,
        resetAt: new Date(bucket.windowStartedAtMs + windowMs),
        retryAfterMs: blockMs,
        blockedUntil: new Date(bucket.blockedUntilMs),
        reason: "limit_exceeded",
      };
    }

    this.buckets.set(input.key, bucket);

    return {
      allowed: true,
      action: input.action,
      scope: input.scope,
      key: input.key,
      storage: this.name,
      limit: input.limit,
      current: bucket.count,
      remaining: Math.max(0, input.limit - bucket.count),
      windowMs,
      resetAt: new Date(bucket.windowStartedAtMs + windowMs),
      retryAfterMs: 0,
      reason: "allowed",
    };
  }

  public clear(): void {
    this.buckets.clear();
  }

  private cleanup(nowMs: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      const windowExpired =
        nowMs - bucket.windowStartedAtMs > 10 * DEFAULT_WINDOW_MS;
      const blockExpired = bucket.blockedUntilMs
        ? bucket.blockedUntilMs < nowMs
        : true;

      if (windowExpired && blockExpired) {
        this.buckets.delete(key);
      }
    }
  }
}

export interface SupabaseRpcRateLimitStoreOptions {
  supabase: SupabaseClient;
  rpcName?: string | undefined;
  failOpen?: boolean | undefined;
}

/**
 * Production rate-limit store.
 *
 * Expected RPC name by default:
 *   ops_check_rate_limit
 *
 * Recommended RPC return shape:
 *   {
 *     allowed: boolean,
 *     current_count: number,
 *     max_hits: number,
 *     remaining: number,
 *     reset_at: string,
 *     retry_after_ms: number,
 *     blocked_until?: string,
 *     reason?: string
 *   }
 *
 * The database RPC should perform atomic insert/update under a transaction.
 */
export class SupabaseRpcRateLimitStore implements RateLimitStore {
  public readonly name = "supabase-rpc" as const;

  private readonly supabase: SupabaseClient;

  private readonly rpcName: string;

  private readonly failOpen: boolean;

  constructor(options: SupabaseRpcRateLimitStoreOptions) {
    this.supabase = options.supabase;
    this.rpcName = options.rpcName ?? "ops_check_rate_limit";
    this.failOpen = options.failOpen ?? true;
  }

  public async consume(
    input: RateLimitStoreConsumeInput,
  ): Promise<RateLimitResult> {
    const fallbackResetAt = new Date(input.now.getTime() + input.windowMs);

    try {
      const { data, error } = await this.supabase.rpc(this.rpcName, {
        p_key: input.key,
        p_action: input.action,
        p_scope: input.scope,
        p_identifier_hash: input.identifierHash,
        p_limit: input.limit,
        p_window_ms: input.windowMs,
        p_block_ms: input.blockMs ?? null,
        p_now: input.now.toISOString(),
        p_metadata: input.metadata ?? {},
      } as never);

      if (error) {
        return this.handleStoreError(input, error.message, fallbackResetAt);
      }

      const row = Array.isArray(data) ? data[0] : data;

      if (!row || typeof row !== "object") {
        return this.handleStoreError(
          input,
          `RPC ${this.rpcName} returned empty or invalid data.`,
          fallbackResetAt,
        );
      }

      const record = row as Record<string, unknown>;

      const allowed = Boolean(
        record.allowed ?? record.is_allowed ?? record.ok ?? false,
      );

      const current = toSafeInteger(
        record.current_count ?? record.current ?? record.count,
        allowed ? 1 : input.limit + 1,
      );

      const limit = toSafeInteger(
        record.max_hits ?? record.limit ?? record.max,
        input.limit,
      );

      const remaining = clampNumber(
        toSafeInteger(record.remaining, Math.max(0, limit - current)),
        0,
        limit,
      );

      const resetAt = toDate(
        record.reset_at ?? record.resetAt,
        fallbackResetAt,
      );

      const blockedUntil = toOptionalDate(
        record.blocked_until ?? record.blockedUntil,
      );

      const retryAfterMs = allowed
        ? 0
        : toSafeInteger(
            record.retry_after_ms ?? record.retryAfterMs,
            blockedUntil
              ? Math.max(0, blockedUntil.getTime() - input.now.getTime())
              : Math.max(0, resetAt.getTime() - input.now.getTime()),
          );

      return {
        allowed,
        action: input.action,
        scope: input.scope,
        key: input.key,
        storage: this.name,
        limit,
        current,
        remaining,
        windowMs: input.windowMs,
        resetAt,
        retryAfterMs,
        blockedUntil,
        reason: normalizeRejectReason(record.reason, allowed),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.handleStoreError(input, message, fallbackResetAt);
    }
  }

  private handleStoreError(
    input: RateLimitStoreConsumeInput,
    storeError: string,
    resetAt: Date,
  ): RateLimitResult {
    if (this.failOpen) {
      return {
        allowed: true,
        action: input.action,
        scope: input.scope,
        key: input.key,
        storage: this.name,
        limit: input.limit,
        current: 0,
        remaining: input.limit,
        windowMs: input.windowMs,
        resetAt,
        retryAfterMs: 0,
        reason: "store_error",
        storeError,
      };
    }

    return {
      allowed: false,
      action: input.action,
      scope: input.scope,
      key: input.key,
      storage: this.name,
      limit: input.limit,
      current: input.limit + 1,
      remaining: 0,
      windowMs: input.windowMs,
      resetAt,
      retryAfterMs: input.blockMs ?? input.windowMs,
      blockedUntil: new Date(Date.now() + (input.blockMs ?? input.windowMs)),
      reason: "store_error",
      storeError,
    };
  }
}

export class NoopRateLimitStore implements RateLimitStore {
  public readonly name = "none" as const;

  public async consume(
    input: RateLimitStoreConsumeInput,
  ): Promise<RateLimitResult> {
    return {
      allowed: true,
      action: input.action,
      scope: input.scope,
      key: input.key,
      storage: this.name,
      limit: input.limit,
      current: 0,
      remaining: input.limit,
      windowMs: input.windowMs,
      resetAt: new Date(input.now.getTime() + input.windowMs),
      retryAfterMs: 0,
      reason: "disabled",
    };
  }
}

export class RateLimiter {
  private readonly store: RateLimitStore;

  private readonly rules: RateLimitRule[];

  private readonly keyPrefix: string;

  private readonly keySecret: string | undefined;

  constructor(options: RateLimiterOptions) {
    this.store = options.store;
    this.rules = options.rules;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.keySecret = options.keySecret ?? getEnv("RATE_LIMIT_HASH_SECRET");
  }

  public async check(
    context: RateLimitRequestContext,
    explicitRules?: RateLimitRule[],
  ): Promise<RateLimitCombinedResult> {
    const now = context.now ?? new Date();
    const rules = explicitRules ?? this.getRulesForAction(context.action);
    const results: RateLimitResult[] = [];

    for (const rule of rules) {
      if (rule.enabled === false) {
        continue;
      }

      const result = await this.checkRule(
        {
          ...context,
          now,
        },
        rule,
      );

      if (result) {
        results.push(result);
      }
    }

    const rejectedResults = results.filter((result) => !result.allowed);
    const rejected =
      rejectedResults.length > 0
        ? rejectedResults.sort((a, b) => b.retryAfterMs - a.retryAfterMs)[0]
        : undefined;

    const primary = rejected ?? selectPrimaryRateLimitResult(results);

    return {
      allowed: !rejected,
      action: context.action,
      results,
      rejected,
      retryAfterMs: rejected?.retryAfterMs ?? 0,
      headers: primary ? getRateLimitHeaders(primary) : {},
    };
  }

  public async assert(
    context: RateLimitRequestContext,
    explicitRules?: RateLimitRule[],
  ): Promise<RateLimitCombinedResult> {
    const result = await this.check(context, explicitRules);

    if (!result.allowed) {
      throw new RateLimitError(result);
    }

    return result;
  }

  public getRulesForAction(action: RateLimitAction): RateLimitRule[] {
    return this.rules.filter(
      (rule) => rule.action === action || rule.action === "*",
    );
  }

  private async checkRule(
    context: RateLimitRequestContext,
    rule: RateLimitRule,
  ): Promise<RateLimitResult | undefined> {
    const built = buildRateLimitKey(rule, context, {
      keyPrefix: rule.keyPrefix ?? this.keyPrefix,
      keySecret: this.keySecret,
    });

    if (!built) {
      return undefined;
    }

    return this.store.consume({
      key: built.key,
      action: rule.action,
      scope: rule.scope,
      identifierHash: built.identifierHash,
      limit: rule.max,
      windowMs: rule.windowMs,
      blockMs: rule.blockMs,
      now: context.now ?? new Date(),
      metadata: sanitizeMetadata({
        ...(context.metadata ?? {}),
        method: context.method,
        path: context.path,
        ruleAction: rule.action,
        requestAction: context.action,
      }),
    });
  }
}

export function createRateLimiter(
  options: CreateRateLimiterOptions = {},
): RateLimiter {
  const keyPrefix =
    options.keyPrefix ?? getEnv("RATE_LIMIT_KEY_PREFIX") ?? DEFAULT_KEY_PREFIX;

  const keySecret = options.keySecret ?? getEnv("RATE_LIMIT_HASH_SECRET");

  const rules = [
    ...(options.rules ?? DEFAULT_RATE_LIMIT_RULES),
    ...(options.extraRules ?? []),
  ];

  const store =
    options.store ??
    (options.supabase
      ? new SupabaseRpcRateLimitStore({
          supabase: options.supabase,
          rpcName: options.rpcName,
          failOpen: options.failOpen ?? true,
        })
      : new MemoryRateLimitStore());

  return new RateLimiter({
    store,
    rules,
    keyPrefix,
    keySecret,
  });
}

export function buildRateLimitKey(
  rule: RateLimitRule,
  context: RateLimitRequestContext,
  options: {
    keyPrefix?: string | undefined;
    keySecret?: string | undefined;
  } = {},
): BuiltRateLimitKey | undefined {
  const subject = getRateLimitSubject(rule.scope, context);

  if (!subject) {
    return undefined;
  }

  const identifierHash = hashIdentifier(subject, options.keySecret);
  const prefix = sanitizeKeyPart(options.keyPrefix ?? DEFAULT_KEY_PREFIX);
  const actionPart = sanitizeKeyPart(rule.action === "*" ? "all" : rule.action);
  const scopePart = sanitizeKeyPart(rule.scope);

  return {
    key: `${prefix}:${actionPart}:${scopePart}:${identifierHash}`,
    identifierHash,
    subject,
  };
}

export function getRateLimitSubject(
  scope: RateLimitScope,
  context: RateLimitRequestContext,
): string | undefined {
  switch (scope) {
    case "global":
      return "global";

    case "ip": {
      const ip = context.ip ?? getClientIp(context.headers);
      return ip ? `ip:${normalizeIp(ip)}` : undefined;
    }

    case "user":
      return context.userId ? `user:${context.userId}` : undefined;

    case "session":
      return context.sessionId ? `session:${context.sessionId}` : undefined;

    case "telegram_user":
      return context.telegramUserId
        ? `telegram_user:${String(context.telegramUserId)}`
        : undefined;

    case "wallet":
      return context.walletAddress
        ? `wallet:${normalizeWalletAddress(context.walletAddress)}`
        : undefined;

    case "custom":
      return context.custom ? `custom:${context.custom}` : undefined;

    default:
      return undefined;
  }
}

export function getClientIp(headers?: HeaderLike): string | undefined {
  if (!headers) {
    return undefined;
  }

  const candidates = [
    "x-vercel-forwarded-for",
    "x-forwarded-for",
    "cf-connecting-ip",
    "x-real-ip",
    "real-ip",
    "remote-addr",
  ];

  for (const name of candidates) {
    const raw = getHeaderValue(headers, name);
    if (!raw) {
      continue;
    }

    const first = String(raw).split(",")[0]?.trim();

    if (first) {
      return first;
    }
  }

  return undefined;
}

export function getHeaderValue(
  headers: HeaderLike | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const lowerName = name.toLowerCase();

  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get(name: string): string | null }).get(name);
    return value ?? undefined;
  }

  const record = headers as Record<string, HeaderValue>;

  for (const key of Object.keys(record)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }

    const value = record[key];

    if (Array.isArray(value)) {
      return value[0] ? String(value[0]) : undefined;
    }

    if (value === undefined || value === null) {
      return undefined;
    }

    return String(value);
  }

  return undefined;
}

export function getRateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1_000);

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt.getTime() / 1_000)),
    "X-RateLimit-Action": String(result.action),
    "X-RateLimit-Scope": String(result.scope),
  };

  if (!result.allowed) {
    headers["Retry-After"] = String(Math.max(1, retryAfterSeconds));
  }

  return headers;
}

export function hashIdentifier(value: string, secret?: string): string {
  const normalized = value.trim().toLowerCase();

  if (secret) {
    return createHmac("sha256", secret).update(normalized).digest("hex");
  }

  return createHash("sha256").update(normalized).digest("hex");
}

export function sanitizeMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key) || looksSensitiveKey(key)) {
      output[key] = "[redacted]";
      continue;
    }

    output[key] = sanitizeMetadataValue(value);
  }

  return output;
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadataValue(item));
  }

  if (typeof value === "object" && value) {
    const objectValue = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(objectValue).slice(0, 50)) {
      if (SENSITIVE_METADATA_KEYS.has(key) || looksSensitiveKey(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = sanitizeMetadataValue(nestedValue);
      }
    }

    return output;
  }

  return String(value);
}

function looksSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();

  return (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("private") ||
    normalized.includes("cookie") ||
    normalized.includes("signature") ||
    normalized.includes("authorization")
  );
}

function selectPrimaryRateLimitResult(
  results: RateLimitResult[],
): RateLimitResult | undefined {
  if (results.length === 0) {
    return undefined;
  }

  return results.reduce((best, current) => {
    const bestRatio = best.limit > 0 ? best.remaining / best.limit : 0;
    const currentRatio =
      current.limit > 0 ? current.remaining / current.limit : 0;

    return currentRatio < bestRatio ? current : best;
  });
}

function normalizeRejectReason(
  value: unknown,
  allowed: boolean,
): RateLimitRejectReason {
  if (allowed) {
    return "allowed";
  }

  const text = typeof value === "string" ? value : "";

  if (
    text === "blocked" ||
    text === "limit_exceeded" ||
    text === "store_error" ||
    text === "missing_subject"
  ) {
    return text;
  }

  return "limit_exceeded";
}

function normalizeIp(ip: string): string {
  return ip.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function normalizeWalletAddress(address: string): string {
  return address.trim().toLowerCase();
}

function sanitizeKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function toSafeInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.floor(parsed));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);

    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return fallback;
}

function toOptionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = toDate(value, new Date(Number.NaN));

  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function getEnv(name: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }

  return process.env[name];
}
