/* packages/server/src/security/riskControl.ts */

import { createHash, createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createRateLimiter,
  getClientIp,
  getHeaderValue,
  sanitizeMetadata,
} from './rateLimit.js';
import type {
  HeaderLike,
  RateLimitAction,
  RateLimitCombinedResult,
  RateLimitRule,
  RateLimiter,
} from './rateLimit.js';

export type RiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type RiskDecision = 'allow' | 'challenge' | 'review' | 'deny';

export type RiskAction = RateLimitAction;

export interface RiskSignal {
  code: string;
  severity: RiskSeverity;
  score: number;
  message: string;
  decision?: RiskDecision;
  metadata?: Record<string, unknown>;
}

export interface RiskMetadata extends Record<string, unknown> {
  authDateUnix?: number;
  initDataValidated?: boolean;

  boxId?: string;
  boxStatus?: string;
  drawCount?: number;
  expectedStarsAmount?: number;
  actualStarsAmount?: number;
  orderId?: string;
  orderStatus?: string;

  telegramPaymentChargeId?: string;
  providerPaymentChargeId?: string;
  duplicatePayment?: boolean;
  paymentOrderFound?: boolean;

  listingId?: string;
  listingStatus?: string;
  sellerId?: string;
  buyerId?: string;
  priceKcoin?: number;
  marketReferencePriceKcoin?: number;
  minSuggestedPriceKcoin?: number;
  maxSuggestedPriceKcoin?: number;
  quantity?: number;
  buyerBalanceKcoin?: number;

  itemId?: string;
  itemIds?: string[];
  itemLocked?: boolean;
  itemListed?: boolean;
  itemMinting?: boolean;
  itemMinted?: boolean;
  itemCount?: number;
  sameTemplate?: boolean;
  maxLevelReached?: boolean;

  taskId?: string;
  alreadyClaimed?: boolean;
  alreadyCheckedIn?: boolean;

  inviterId?: string;
  inviteeId?: string;
  sameIpInvite?: boolean;
  inviteeCompletedFirstOpen?: boolean;

  walletAddress?: string;
  invalidWalletAddress?: boolean;
  walletAddressReuseCount?: number;
  tonProofProvided?: boolean;

  idempotencyKey?: string;
}

export interface RiskCheckInput {
  action: RiskAction;
  userId?: string;
  telegramUserId?: string | number;
  sessionId?: string;
  walletAddress?: string;
  ip?: string;
  userAgent?: string;
  headers?: HeaderLike;
  method?: string;
  path?: string;
  idempotencyKey?: string;
  metadata?: RiskMetadata;
  now?: Date;
  skipRateLimit?: boolean;
  skipEventWrite?: boolean;
}

export interface RiskAssessment {
  action: RiskAction;
  decision: RiskDecision;
  severity: RiskSeverity;
  score: number;
  signals: RiskSignal[];
  rateLimit?: RateLimitCombinedResult;
  requiredActions: string[];
  userId?: string;
  telegramUserId?: string | number;
  sessionId?: string;
  walletAddress?: string;
  ipHash?: string;
  userAgentHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RiskThresholds {
  challenge: number;
  review: number;
  deny: number;
}

export interface RiskPolicy {
  thresholds: RiskThresholds;
  failOnDecision: RiskDecision[];
  writeEventMinSeverity: RiskSeverity;
  maxTelegramInitDataAgeSeconds: number;
  suspiciousUserAgents: RegExp[];

  market: {
    minPriceKcoin: number;
    maxQuantityPerListing: number;
    minReferenceRatioReview: number;
    minReferenceRatioDeny: number;
    maxReferenceRatioReview: number;
    maxReferenceRatioDeny: number;
  };

  gacha: {
    allowedDrawCounts: number[];
    requireIdempotencyKey: boolean;
  };

  referral: {
    denySelfInvite: boolean;
    reviewSameIpInvite: boolean;
  };

  wallet: {
    reviewReuseCount: number;
    denyReuseCount: number;
  };

  payment: {
    denyMissingPaymentChargeId: boolean;
    denyMissingPaymentOrder: boolean;
  };
}

export interface PartialRiskPolicy {
  thresholds?: Partial<RiskThresholds>;
  failOnDecision?: RiskDecision[];
  writeEventMinSeverity?: RiskSeverity;
  maxTelegramInitDataAgeSeconds?: number;
  suspiciousUserAgents?: RegExp[];

  market?: Partial<RiskPolicy['market']>;
  gacha?: Partial<RiskPolicy['gacha']>;
  referral?: Partial<RiskPolicy['referral']>;
  wallet?: Partial<RiskPolicy['wallet']>;
  payment?: Partial<RiskPolicy['payment']>;
}

export interface RiskEventRecord {
  user_id?: string | null;
  telegram_user_id?: string | number | null;
  session_id?: string | null;
  action: RiskAction;
  decision: RiskDecision;
  severity: RiskSeverity;
  score: number;
  signals: RiskSignal[];
  ip_hash?: string | null;
  user_agent_hash?: string | null;
  wallet_address_hash?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export type RiskEventWriter = (
  event: RiskEventRecord,
) => Promise<void> | void;

export interface CreateRiskControlOptions {
  supabase?: SupabaseClient;
  rateLimiter?: RateLimiter;
  rateLimitRules?: RateLimitRule[];
  policy?: PartialRiskPolicy;
  eventWriter?: RiskEventWriter;
  enableRateLimit?: boolean;
  hashSecret?: string;
}

interface RiskControlOptions extends CreateRiskControlOptions {
  policy?: PartialRiskPolicy;
}

interface UserFlagRecord {
  flag: string;
  severity?: RiskSeverity | string | null;
  expires_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface NormalizedRiskCheckInput extends RiskCheckInput {
  now: Date;
  metadata: RiskMetadata;
  ip?: string;
  userAgent?: string;
}

const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const DECISION_ORDER: Record<RiskDecision, number> = {
  allow: 0,
  challenge: 1,
  review: 2,
  deny: 3,
};

const DEFAULT_RISK_POLICY: RiskPolicy = {
  thresholds: {
    challenge: 40,
    review: 70,
    deny: 95,
  },

  failOnDecision: ['deny'],

  writeEventMinSeverity: 'medium',

  maxTelegramInitDataAgeSeconds: 24 * 60 * 60,

  suspiciousUserAgents: [
    /curl/i,
    /wget/i,
    /python-requests/i,
    /httpclient/i,
    /postman/i,
    /insomnia/i,
    /scrapy/i,
    /bot/i,
  ],

  market: {
    minPriceKcoin: 1,
    maxQuantityPerListing: 999,
    minReferenceRatioReview: 0.25,
    minReferenceRatioDeny: 0.05,
    maxReferenceRatioReview: 10,
    maxReferenceRatioDeny: 100,
  },

  gacha: {
    allowedDrawCounts: [1, 10],
    requireIdempotencyKey: true,
  },

  referral: {
    denySelfInvite: true,
    reviewSameIpInvite: true,
  },

  wallet: {
    reviewReuseCount: 3,
    denyReuseCount: 8,
  },

  payment: {
    denyMissingPaymentChargeId: true,
    denyMissingPaymentOrder: true,
  },
};

export class RiskControlError extends Error {
  public readonly statusCode: number;

  public readonly assessment: RiskAssessment;

  constructor(
    assessment: RiskAssessment,
    message = '当前操作存在风险，已被系统拦截。',
  ) {
    super(message);
    this.name = 'RiskControlError';
    this.assessment = assessment;
    this.statusCode = getRecommendedRiskHttpStatus(assessment);
  }
}

export class RiskControl {
  private readonly supabase?: SupabaseClient;

  private readonly rateLimiter?: RateLimiter;

  private readonly policy: RiskPolicy;

  private readonly eventWriter?: RiskEventWriter;

  private readonly hashSecret?: string;

  constructor(options: RiskControlOptions = {}) {
    this.supabase = options.supabase;
    this.rateLimiter = options.rateLimiter;
    this.policy = mergeRiskPolicy(DEFAULT_RISK_POLICY, options.policy);
    this.eventWriter = options.eventWriter;
    this.hashSecret =
      options.hashSecret ??
      getEnv('RISK_HASH_SECRET') ??
      getEnv('RATE_LIMIT_HASH_SECRET');
  }

  public async evaluate(input: RiskCheckInput): Promise<RiskAssessment> {
    const normalized = this.normalizeInput(input);
    const signals: RiskSignal[] = [];

    this.addIdentitySignals(normalized, signals);
    this.addTransportSignals(normalized, signals);
    this.addIdempotencySignals(normalized, signals);

    const rateLimit = await this.evaluateRateLimit(normalized, signals);
    const userFlags = await this.loadUserFlags(normalized);
    this.addUserFlagSignals(normalized, userFlags, signals);
    this.addActionSpecificSignals(normalized, signals);

    const score = calculateRiskScore(signals);
    const severity = calculateRiskSeverity(signals, score);
    const decision = resolveRiskDecision(score, signals, this.policy.thresholds);
    const requiredActions = getRequiredActions(decision, signals);

    const assessment: RiskAssessment = {
      action: normalized.action,
      decision,
      severity,
      score,
      signals,
      rateLimit,
      requiredActions,
      userId: normalized.userId,
      telegramUserId: normalized.telegramUserId,
      sessionId: normalized.sessionId,
      walletAddress: normalized.walletAddress,
      ipHash: normalized.ip ? this.hashForStorage(`ip:${normalized.ip}`) : undefined,
      userAgentHash: normalized.userAgent
        ? this.hashForStorage(`ua:${normalized.userAgent}`)
        : undefined,
      metadata: sanitizeMetadata(normalized.metadata),
      createdAt: normalized.now.toISOString(),
    };

    if (!normalized.skipEventWrite && this.shouldWriteEvent(assessment)) {
      await this.writeRiskEvent(assessment);
    }

    return assessment;
  }

  public async assertAllowed(
    input: RiskCheckInput,
    options?: {
      failOnDecision?: RiskDecision[];
      message?: string;
    },
  ): Promise<RiskAssessment> {
    const assessment = await this.evaluate(input);
    const failOnDecision =
      options?.failOnDecision ?? this.policy.failOnDecision;

    if (failOnDecision.includes(assessment.decision)) {
      throw new RiskControlError(assessment, options?.message);
    }

    return assessment;
  }

  public async recordManualEvent(event: RiskEventRecord): Promise<void> {
    if (this.eventWriter) {
      await this.eventWriter(event);
      return;
    }

    if (!this.supabase) {
      return;
    }

    const db = this.supabase as unknown as {
      schema(schema: string): {
        from(table: string): {
          insert(payload: unknown): Promise<{ error?: { message: string } | null }>;
        };
      };
    };

    await db.schema('ops').from('risk_events').insert(event);
  }

  private normalizeInput(input: RiskCheckInput): NormalizedRiskCheckInput {
    const now = input.now ?? new Date();
    const headers = input.headers;
    const ip = input.ip ?? getClientIp(headers);
    const userAgent =
      input.userAgent ??
      (headers ? getHeaderValue(headers, 'user-agent') : undefined);

    return {
      ...input,
      now,
      ip,
      userAgent,
      metadata: {
        ...(input.metadata ?? {}),
        idempotencyKey: input.idempotencyKey ?? input.metadata?.idempotencyKey,
      },
    };
  }

  private addIdentitySignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    if (requiresUser(input.action) && !input.userId) {
      pushSignal(signals, {
        code: 'MISSING_USER_SESSION',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: '需要用户会话的操作缺少 userId。',
      });
    }

    if (requiresSession(input.action) && !input.sessionId) {
      pushSignal(signals, {
        code: 'MISSING_APP_SESSION',
        severity: 'high',
        score: 80,
        decision: 'review',
        message: '需要登录态的操作缺少 sessionId。',
      });
    }

    if (
      input.action === 'auth.telegram' &&
      input.metadata.initDataValidated === false
    ) {
      pushSignal(signals, {
        code: 'TELEGRAM_INIT_DATA_INVALID',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: 'Telegram initData 服务端校验失败。',
      });
    }

    const authDateUnix = getNumber(input.metadata, 'authDateUnix');

    if (input.action === 'auth.telegram' && authDateUnix) {
      const ageSeconds = Math.floor(input.now.getTime() / 1_000) - authDateUnix;

      if (ageSeconds > this.policy.maxTelegramInitDataAgeSeconds) {
        pushSignal(signals, {
          code: 'TELEGRAM_INIT_DATA_TOO_OLD',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: 'Telegram initData 已超过允许时间窗口。',
          metadata: {
            ageSeconds,
            maxAgeSeconds: this.policy.maxTelegramInitDataAgeSeconds,
          },
        });
      }
    }
  }

  private addTransportSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    if (isMachineAction(input.action)) {
      return;
    }

    if (!input.ip) {
      pushSignal(signals, {
        code: 'MISSING_CLIENT_IP',
        severity: 'low',
        score: 10,
        message: '请求缺少可识别客户端 IP。',
      });
    }

    if (!input.userAgent) {
      pushSignal(signals, {
        code: 'MISSING_USER_AGENT',
        severity: 'low',
        score: 10,
        message: '请求缺少 user-agent。',
      });
      return;
    }

    const suspicious = this.policy.suspiciousUserAgents.some((rule) =>
      rule.test(input.userAgent ?? ''),
    );

    if (suspicious) {
      pushSignal(signals, {
        code: 'SUSPICIOUS_USER_AGENT',
        severity: 'medium',
        score: 35,
        decision: 'challenge',
        message: '请求 user-agent 不符合正常 Telegram Mini App 访问特征。',
        metadata: {
          userAgentHash: this.hashForStorage(`ua:${input.userAgent}`),
        },
      });
    }
  }

  private addIdempotencySignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    const requiresIdempotency =
      input.action === 'box.create_open_order' ||
      input.action === 'market.buy' ||
      input.action === 'market.create_listing' ||
      input.action === 'inventory.upgrade' ||
      input.action === 'inventory.evolve' ||
      input.action === 'inventory.decompose' ||
      input.action === 'tasks.claim' ||
      input.action === 'tasks.check_in' ||
      input.action === 'wallet.mint';

    const idempotencyKey = getString(input.metadata, 'idempotencyKey');

    if (requiresIdempotency && !idempotencyKey) {
      pushSignal(signals, {
        code: 'MISSING_IDEMPOTENCY_KEY',
        severity: 'medium',
        score: 30,
        decision: 'challenge',
        message: '写操作缺少幂等键，可能导致重复提交。',
      });
    }
  }

  private async evaluateRateLimit(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): Promise<RateLimitCombinedResult | undefined> {
    if (!this.rateLimiter || input.skipRateLimit) {
      return undefined;
    }

    const result = await this.rateLimiter.check({
      action: input.action,
      userId: input.userId,
      sessionId: input.sessionId,
      telegramUserId: input.telegramUserId,
      walletAddress: input.walletAddress ?? getString(input.metadata, 'walletAddress'),
      ip: input.ip,
      userAgent: input.userAgent,
      method: input.method,
      path: input.path,
      now: input.now,
      metadata: input.metadata,
    });

    if (!result.allowed) {
      pushSignal(signals, {
        code: 'RATE_LIMIT_EXCEEDED',
        severity: 'high',
        score: 100,
        decision: 'deny',
        message: '请求频率超过限制。',
        metadata: {
          retryAfterMs: result.retryAfterMs,
          scope: result.rejected?.scope,
          limit: result.rejected?.limit,
          remaining: result.rejected?.remaining,
          reason: result.rejected?.reason,
        },
      });
    }

    return result;
  }

  private async loadUserFlags(
    input: NormalizedRiskCheckInput,
  ): Promise<UserFlagRecord[]> {
    if (!this.supabase || !input.userId) {
      return [];
    }

    try {
      const db = this.supabase as unknown as {
        schema(schema: string): {
          from(table: string): {
            select(columns: string): {
              eq(column: string, value: string): {
                limit(count: number): Promise<{
                  data?: UserFlagRecord[] | null;
                  error?: { message: string } | null;
                }>;
              };
            };
          };
        };
      };

      const { data, error } = await db
        .schema('core')
        .from('user_flags')
        .select('flag,severity,expires_at,metadata')
        .eq('user_id', input.userId)
        .limit(50);

      if (error || !data) {
        return [];
      }

      return data.filter((flag) => {
        if (!flag.expires_at) {
          return true;
        }

        const expiresAt = new Date(flag.expires_at);
        return Number.isFinite(expiresAt.getTime()) && expiresAt > input.now;
      });
    } catch {
      return [];
    }
  }

  private addUserFlagSignals(
    input: NormalizedRiskCheckInput,
    flags: UserFlagRecord[],
    signals: RiskSignal[],
  ): void {
    for (const flag of flags) {
      const flagName = String(flag.flag).toLowerCase();
      const severity = normalizeSeverity(flag.severity, 'high');

      if (flagName === 'banned' || flagName === 'suspended') {
        pushSignal(signals, {
          code: 'USER_BANNED',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '用户已被封禁或暂停。',
          metadata: sanitizeMetadata(flag.metadata ?? {}),
        });
        continue;
      }

      if (
        (flagName === 'market_restricted' || flagName === 'trade_restricted') &&
        isMarketAction(input.action)
      ) {
        pushSignal(signals, {
          code: 'USER_MARKET_RESTRICTED',
          severity,
          score: 90,
          decision: 'deny',
          message: '用户被限制使用交易市场。',
          metadata: sanitizeMetadata(flag.metadata ?? {}),
        });
        continue;
      }

      if (flagName === 'gacha_restricted' && isGachaAction(input.action)) {
        pushSignal(signals, {
          code: 'USER_GACHA_RESTRICTED',
          severity,
          score: 90,
          decision: 'deny',
          message: '用户被限制开盒。',
          metadata: sanitizeMetadata(flag.metadata ?? {}),
        });
        continue;
      }

      if (flagName === 'wallet_restricted' && isWalletAction(input.action)) {
        pushSignal(signals, {
          code: 'USER_WALLET_RESTRICTED',
          severity,
          score: 90,
          decision: 'deny',
          message: '用户被限制使用钱包或链上功能。',
          metadata: sanitizeMetadata(flag.metadata ?? {}),
        });
        continue;
      }

      if (flagName === 'task_restricted' && isTaskAction(input.action)) {
        pushSignal(signals, {
          code: 'USER_TASK_RESTRICTED',
          severity,
          score: 90,
          decision: 'deny',
          message: '用户被限制领取任务奖励。',
          metadata: sanitizeMetadata(flag.metadata ?? {}),
        });
        continue;
      }

      if (flagName === 'risk_watch' || flagName === 'payment_review') {
        pushSignal(signals, {
          code: 'USER_UNDER_RISK_WATCH',
          severity: normalizeSeverity(flag.severity, 'medium'),
          score: 45,
          decision: 'review',
          message: '用户处于风控观察状态。',
          metadata: sanitizeMetadata(flag.metadata ?? {}),
        });
      }
    }
  }

  private addActionSpecificSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    if (input.action === 'auth.telegram') {
      this.addReferralSignals(input, signals);
    }

    if (isGachaAction(input.action)) {
      this.addGachaSignals(input, signals);
    }

    if (input.action === 'telegram.webhook') {
      this.addPaymentWebhookSignals(input, signals);
    }

    if (isMarketAction(input.action)) {
      this.addMarketSignals(input, signals);
    }

    if (isInventoryAction(input.action)) {
      this.addInventorySignals(input, signals);
    }

    if (isTaskAction(input.action)) {
      this.addTaskSignals(input, signals);
      this.addReferralSignals(input, signals);
    }

    if (isWalletAction(input.action)) {
      this.addWalletSignals(input, signals);
    }
  }

  private addGachaSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    if (input.action !== 'box.create_open_order') {
      return;
    }

    const boxStatus = getString(input.metadata, 'boxStatus');
    if (boxStatus && boxStatus !== 'active') {
      pushSignal(signals, {
        code: 'BOX_NOT_ACTIVE',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: '盲盒当前不可开启。',
        metadata: {
          boxStatus,
        },
      });
    }

    const drawCount = getNumber(input.metadata, 'drawCount');
    if (
      drawCount !== undefined &&
      !this.policy.gacha.allowedDrawCounts.includes(drawCount)
    ) {
      pushSignal(signals, {
        code: 'INVALID_DRAW_COUNT',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: '开盒次数非法，仅允许单抽或十连。',
        metadata: {
          drawCount,
          allowedDrawCounts: this.policy.gacha.allowedDrawCounts,
        },
      });
    }

    const expectedStarsAmount = getNumber(input.metadata, 'expectedStarsAmount');
    const actualStarsAmount = getNumber(input.metadata, 'actualStarsAmount');

    if (
      expectedStarsAmount !== undefined &&
      actualStarsAmount !== undefined &&
      expectedStarsAmount !== actualStarsAmount
    ) {
      pushSignal(signals, {
        code: 'STARS_AMOUNT_MISMATCH',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: 'Stars 支付金额与服务端计算金额不一致。',
        metadata: {
          expectedStarsAmount,
          actualStarsAmount,
        },
      });
    }
  }

  private addPaymentWebhookSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    const paymentChargeId = getString(input.metadata, 'telegramPaymentChargeId');
    const orderFound = getBoolean(input.metadata, 'paymentOrderFound');
    const duplicatePayment = getBoolean(input.metadata, 'duplicatePayment');

    if (this.policy.payment.denyMissingPaymentChargeId && !paymentChargeId) {
      pushSignal(signals, {
        code: 'MISSING_TELEGRAM_PAYMENT_CHARGE_ID',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: 'Telegram Stars 支付回调缺少 payment charge id。',
      });
    }

    if (this.policy.payment.denyMissingPaymentOrder && orderFound === false) {
      pushSignal(signals, {
        code: 'PAYMENT_ORDER_NOT_FOUND',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: '支付回调无法匹配本地订单。',
      });
    }

    if (duplicatePayment === true) {
      pushSignal(signals, {
        code: 'DUPLICATE_PAYMENT_CALLBACK',
        severity: 'high',
        score: 80,
        decision: 'review',
        message: '检测到重复支付回调，应走幂等处理，不可重复发货。',
        metadata: {
          telegramPaymentChargeId: paymentChargeId ? '[present]' : '[missing]',
        },
      });
    }
  }

  private addMarketSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    const priceKcoin = getNumber(input.metadata, 'priceKcoin');
    const quantity = getNumber(input.metadata, 'quantity');
    const buyerId = getString(input.metadata, 'buyerId') ?? input.userId;
    const sellerId = getString(input.metadata, 'sellerId');
    const listingStatus = getString(input.metadata, 'listingStatus');

    if (input.action === 'market.buy') {
      if (sellerId && buyerId && sameId(sellerId, buyerId)) {
        pushSignal(signals, {
          code: 'MARKET_SELF_TRADE',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '买家和卖家相同，禁止自买自卖。',
          metadata: {
            sellerId,
            buyerId,
          },
        });
      }

      if (listingStatus && listingStatus !== 'active') {
        pushSignal(signals, {
          code: 'LISTING_NOT_ACTIVE',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '挂单不是可购买状态。',
          metadata: {
            listingStatus,
          },
        });
      }

      const buyerBalanceKcoin = getNumber(input.metadata, 'buyerBalanceKcoin');
      if (
        priceKcoin !== undefined &&
        buyerBalanceKcoin !== undefined &&
        buyerBalanceKcoin < priceKcoin
      ) {
        pushSignal(signals, {
          code: 'INSUFFICIENT_KCOIN_BALANCE',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '买家 K-coin 余额不足。',
          metadata: {
            priceKcoin,
            buyerBalanceKcoin,
          },
        });
      }
    }

    if (
      input.action === 'market.create_listing' ||
      input.action === 'market.update_price' ||
      input.action === 'market.buy'
    ) {
      if (priceKcoin !== undefined && priceKcoin < this.policy.market.minPriceKcoin) {
        pushSignal(signals, {
          code: 'MARKET_PRICE_BELOW_MINIMUM',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '交易价格低于系统允许的最低价格。',
          metadata: {
            priceKcoin,
            minPriceKcoin: this.policy.market.minPriceKcoin,
          },
        });
      }

      if (
        quantity !== undefined &&
        (quantity <= 0 || quantity > this.policy.market.maxQuantityPerListing)
      ) {
        pushSignal(signals, {
          code: 'MARKET_INVALID_QUANTITY',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '挂单数量非法。',
          metadata: {
            quantity,
            maxQuantityPerListing: this.policy.market.maxQuantityPerListing,
          },
        });
      }

      this.addMarketPriceHealthSignals(input, signals);
    }
  }

  private addMarketPriceHealthSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    const priceKcoin = getNumber(input.metadata, 'priceKcoin');
    const reference = getNumber(input.metadata, 'marketReferencePriceKcoin');
    const minSuggested = getNumber(input.metadata, 'minSuggestedPriceKcoin');
    const maxSuggested = getNumber(input.metadata, 'maxSuggestedPriceKcoin');

    if (!priceKcoin || priceKcoin <= 0) {
      return;
    }

    if (minSuggested !== undefined && priceKcoin < minSuggested) {
      pushSignal(signals, {
        code: 'PRICE_BELOW_SUGGESTED_RANGE',
        severity: 'medium',
        score: 30,
        decision: 'challenge',
        message: '出售价格低于建议价格区间。',
        metadata: {
          priceKcoin,
          minSuggestedPriceKcoin: minSuggested,
        },
      });
    }

    if (maxSuggested !== undefined && priceKcoin > maxSuggested) {
      pushSignal(signals, {
        code: 'PRICE_ABOVE_SUGGESTED_RANGE',
        severity: 'medium',
        score: 25,
        decision: 'challenge',
        message: '出售价格高于建议价格区间。',
        metadata: {
          priceKcoin,
          maxSuggestedPriceKcoin: maxSuggested,
        },
      });
    }

    if (!reference || reference <= 0) {
      return;
    }

    const ratio = priceKcoin / reference;

    if (ratio <= this.policy.market.minReferenceRatioDeny) {
      pushSignal(signals, {
        code: 'PRICE_EXTREMELY_UNDER_REFERENCE',
        severity: 'high',
        score: 80,
        decision: 'review',
        message: '交易价格极低，可能是异常转移或误操作。',
        metadata: {
          ratio,
          priceKcoin,
          marketReferencePriceKcoin: reference,
        },
      });
      return;
    }

    if (ratio <= this.policy.market.minReferenceRatioReview) {
      pushSignal(signals, {
        code: 'PRICE_UNDER_REFERENCE',
        severity: 'medium',
        score: 40,
        decision: 'challenge',
        message: '交易价格明显低于市场参考价。',
        metadata: {
          ratio,
          priceKcoin,
          marketReferencePriceKcoin: reference,
        },
      });
    }

    if (ratio >= this.policy.market.maxReferenceRatioDeny) {
      pushSignal(signals, {
        code: 'PRICE_EXTREMELY_OVER_REFERENCE',
        severity: 'high',
        score: 70,
        decision: 'review',
        message: '交易价格极高，可能存在异常交易或价格操纵。',
        metadata: {
          ratio,
          priceKcoin,
          marketReferencePriceKcoin: reference,
        },
      });
      return;
    }

    if (ratio >= this.policy.market.maxReferenceRatioReview) {
      pushSignal(signals, {
        code: 'PRICE_OVER_REFERENCE',
        severity: 'medium',
        score: 35,
        decision: 'challenge',
        message: '交易价格明显高于市场参考价。',
        metadata: {
          ratio,
          priceKcoin,
          marketReferencePriceKcoin: reference,
        },
      });
    }
  }

  private addInventorySignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    const itemLocked = getBoolean(input.metadata, 'itemLocked');
    const itemListed = getBoolean(input.metadata, 'itemListed');
    const itemMinting = getBoolean(input.metadata, 'itemMinting');
    const itemMinted = getBoolean(input.metadata, 'itemMinted');

    if (
      (input.action === 'inventory.upgrade' ||
        input.action === 'inventory.evolve' ||
        input.action === 'inventory.decompose') &&
      (itemLocked || itemListed || itemMinting)
    ) {
      pushSignal(signals, {
        code: 'ITEM_NOT_AVAILABLE_FOR_INVENTORY_ACTION',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: '藏品处于锁定、挂售或 Mint 中状态，不能执行该库存操作。',
        metadata: {
          itemLocked,
          itemListed,
          itemMinting,
        },
      });
    }

    if (input.action === 'inventory.upgrade') {
      const maxLevelReached = getBoolean(input.metadata, 'maxLevelReached');

      if (maxLevelReached) {
        pushSignal(signals, {
          code: 'ITEM_MAX_LEVEL_REACHED',
          severity: 'high',
          score: 90,
          decision: 'deny',
          message: '藏品已达到最高等级，不能继续升级。',
        });
      }
    }

    if (input.action === 'inventory.evolve') {
      const itemCount = getNumber(input.metadata, 'itemCount');
      const sameTemplate = getBoolean(input.metadata, 'sameTemplate');

      if (itemCount !== undefined && itemCount !== 3) {
        pushSignal(signals, {
          code: 'EVOLVE_REQUIRES_THREE_ITEMS',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '合成必须消耗 3 份相同藏品。',
          metadata: {
            itemCount,
          },
        });
      }

      if (sameTemplate === false) {
        pushSignal(signals, {
          code: 'EVOLVE_ITEMS_NOT_SAME_TEMPLATE',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '合成材料不是相同藏品。',
        });
      }
    }

    if (input.action === 'inventory.decompose' && itemMinted) {
      pushSignal(signals, {
        code: 'MINTED_ITEM_DECOMPOSE_REVIEW',
        severity: 'high',
        score: 70,
        decision: 'review',
        message: '已 Mint 的链上藏品执行分解需要进入复核或额外校验。',
      });
    }
  }

  private addTaskSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    if (input.action === 'tasks.claim') {
      const alreadyClaimed = getBoolean(input.metadata, 'alreadyClaimed');

      if (alreadyClaimed) {
        pushSignal(signals, {
          code: 'TASK_ALREADY_CLAIMED',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '任务奖励已经领取，不能重复领取。',
        });
      }
    }

    if (input.action === 'tasks.check_in') {
      const alreadyCheckedIn = getBoolean(input.metadata, 'alreadyCheckedIn');

      if (alreadyCheckedIn) {
        pushSignal(signals, {
          code: 'CHECK_IN_ALREADY_CLAIMED',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '今日签到奖励已经领取。',
        });
      }
    }
  }

  private addReferralSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    const inviterId = getString(input.metadata, 'inviterId');
    const inviteeId = getString(input.metadata, 'inviteeId') ?? input.userId;
    const sameIpInvite = getBoolean(input.metadata, 'sameIpInvite');

    if (
      this.policy.referral.denySelfInvite &&
      inviterId &&
      inviteeId &&
      sameId(inviterId, inviteeId)
    ) {
      pushSignal(signals, {
        code: 'REFERRAL_SELF_INVITE',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: '检测到自邀请行为。',
        metadata: {
          inviterId,
          inviteeId,
        },
      });
    }

    if (this.policy.referral.reviewSameIpInvite && sameIpInvite === true) {
      pushSignal(signals, {
        code: 'REFERRAL_SAME_IP',
        severity: 'medium',
        score: 45,
        decision: 'review',
        message: '邀请人与被邀请人使用相同 IP，可能存在刷邀请行为。',
      });
    }
  }

  private addWalletSignals(
    input: NormalizedRiskCheckInput,
    signals: RiskSignal[],
  ): void {
    const walletAddress =
      input.walletAddress ?? getString(input.metadata, 'walletAddress');
    const invalidWalletAddress = getBoolean(input.metadata, 'invalidWalletAddress');
    const tonProofProvided = getBoolean(input.metadata, 'tonProofProvided');
    const reuseCount = getNumber(input.metadata, 'walletAddressReuseCount');

    if (
      input.action !== 'wallet.connect' &&
      input.action !== 'wallet.proof' &&
      input.action !== 'wallet.sync_nfts' &&
      input.action !== 'wallet.mint'
    ) {
      return;
    }

    if (!walletAddress && input.action !== 'wallet.sync_nfts') {
      pushSignal(signals, {
        code: 'MISSING_WALLET_ADDRESS',
        severity: 'high',
        score: 80,
        decision: 'deny',
        message: '钱包操作缺少 TON 钱包地址。',
      });
    }

    if (invalidWalletAddress === true) {
      pushSignal(signals, {
        code: 'INVALID_WALLET_ADDRESS',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: 'TON 钱包地址格式非法。',
      });
    }

    if (input.action === 'wallet.proof' && tonProofProvided === false) {
      pushSignal(signals, {
        code: 'MISSING_TON_PROOF',
        severity: 'critical',
        score: 100,
        decision: 'deny',
        message: '钱包验证缺少 ton_proof。',
      });
    }

    if (reuseCount !== undefined) {
      if (reuseCount >= this.policy.wallet.denyReuseCount) {
        pushSignal(signals, {
          code: 'WALLET_ADDRESS_HEAVILY_REUSED',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '同一钱包地址被过多用户绑定。',
          metadata: {
            walletAddressHash: walletAddress
              ? this.hashForStorage(`wallet:${walletAddress}`)
              : undefined,
            reuseCount,
          },
        });
      } else if (reuseCount >= this.policy.wallet.reviewReuseCount) {
        pushSignal(signals, {
          code: 'WALLET_ADDRESS_REUSED',
          severity: 'high',
          score: 70,
          decision: 'review',
          message: '同一钱包地址被多个用户绑定，需要复核。',
          metadata: {
            walletAddressHash: walletAddress
              ? this.hashForStorage(`wallet:${walletAddress}`)
              : undefined,
            reuseCount,
          },
        });
      }
    }

    if (input.action === 'wallet.mint') {
      const itemLocked = getBoolean(input.metadata, 'itemLocked');
      const itemMinting = getBoolean(input.metadata, 'itemMinting');
      const itemMinted = getBoolean(input.metadata, 'itemMinted');

      if (itemLocked || itemMinting || itemMinted) {
        pushSignal(signals, {
          code: 'ITEM_NOT_AVAILABLE_FOR_MINT',
          severity: 'critical',
          score: 100,
          decision: 'deny',
          message: '藏品不可进入 Mint 队列，可能已锁定、Mint 中或已 Mint。',
          metadata: {
            itemLocked,
            itemMinting,
            itemMinted,
          },
        });
      }
    }
  }

  private shouldWriteEvent(assessment: RiskAssessment): boolean {
    if (assessment.decision !== 'allow') {
      return true;
    }

    if (assessment.signals.length === 0) {
      return false;
    }

    return (
      SEVERITY_ORDER[assessment.severity] >=
      SEVERITY_ORDER[this.policy.writeEventMinSeverity]
    );
  }

  private async writeRiskEvent(assessment: RiskAssessment): Promise<void> {
    const event: RiskEventRecord = {
      user_id: assessment.userId ?? null,
      telegram_user_id: assessment.telegramUserId ?? null,
      session_id: assessment.sessionId ?? null,
      action: assessment.action,
      decision: assessment.decision,
      severity: assessment.severity,
      score: assessment.score,
      signals: assessment.signals,
      ip_hash: assessment.ipHash ?? null,
      user_agent_hash: assessment.userAgentHash ?? null,
      wallet_address_hash: assessment.walletAddress
        ? this.hashForStorage(`wallet:${assessment.walletAddress}`)
        : null,
      metadata: assessment.metadata,
      created_at: assessment.createdAt,
    };

    if (this.eventWriter) {
      await this.eventWriter(event);
      return;
    }

    if (!this.supabase) {
      return;
    }

    try {
      const db = this.supabase as unknown as {
        schema(schema: string): {
          from(table: string): {
            insert(payload: unknown): Promise<{ error?: { message: string } | null }>;
          };
        };
      };

      await db.schema('ops').from('risk_events').insert(event);
    } catch {
      // 风控事件写入失败不能影响主业务判断结果。
      // 真正阻断与否由 assessment.decision 决定。
    }
  }

  private hashForStorage(value: string): string {
    const normalized = value.trim().toLowerCase();

    if (this.hashSecret) {
      return createHmac('sha256', this.hashSecret)
        .update(normalized)
        .digest('hex');
    }

    return createHash('sha256').update(normalized).digest('hex');
  }
}

export function createRiskControl(
  options: CreateRiskControlOptions = {},
): RiskControl {
  const rateLimiter =
    options.rateLimiter ??
    (options.enableRateLimit === false
      ? undefined
      : createRateLimiter({
          supabase: options.supabase,
          rules: options.rateLimitRules,
          keySecret:
            options.hashSecret ??
            getEnv('RISK_HASH_SECRET') ??
            getEnv('RATE_LIMIT_HASH_SECRET'),
        }));

  return new RiskControl({
    ...options,
    rateLimiter,
  });
}

export function getRecommendedRiskHttpStatus(
  assessment: RiskAssessment,
): number {
  const hasRateLimitSignal = assessment.signals.some(
    (signal) => signal.code === 'RATE_LIMIT_EXCEEDED',
  );

  if (hasRateLimitSignal) {
    return 429;
  }

  if (assessment.decision === 'deny') {
    return 403;
  }

  if (assessment.decision === 'review') {
    return 409;
  }

  if (assessment.decision === 'challenge') {
    return 428;
  }

  return 200;
}

function mergeRiskPolicy(
  base: RiskPolicy,
  patch?: PartialRiskPolicy,
): RiskPolicy {
  if (!patch) {
    return base;
  }

  return {
    ...base,
    ...patch,
    thresholds: {
      ...base.thresholds,
      ...(patch.thresholds ?? {}),
    },
    failOnDecision: patch.failOnDecision ?? base.failOnDecision,
    suspiciousUserAgents:
      patch.suspiciousUserAgents ?? base.suspiciousUserAgents,
    market: {
      ...base.market,
      ...(patch.market ?? {}),
    },
    gacha: {
      ...base.gacha,
      ...(patch.gacha ?? {}),
    },
    referral: {
      ...base.referral,
      ...(patch.referral ?? {}),
    },
    wallet: {
      ...base.wallet,
      ...(patch.wallet ?? {}),
    },
    payment: {
      ...base.payment,
      ...(patch.payment ?? {}),
    },
  };
}

function calculateRiskScore(signals: RiskSignal[]): number {
  if (signals.length === 0) {
    return 0;
  }

  const total = signals.reduce((sum, signal) => {
    const score = Number.isFinite(signal.score) ? signal.score : 0;
    return sum + Math.max(0, score);
  }, 0);

  return Math.min(100, Math.round(total));
}

function calculateRiskSeverity(
  signals: RiskSignal[],
  score: number,
): RiskSeverity {
  if (signals.length === 0) {
    return 'info';
  }

  const highestBySignal = signals.reduce<RiskSeverity>((highest, signal) => {
    return SEVERITY_ORDER[signal.severity] > SEVERITY_ORDER[highest]
      ? signal.severity
      : highest;
  }, 'info');

  if (highestBySignal !== 'info') {
    return highestBySignal;
  }

  if (score >= 95) {
    return 'critical';
  }

  if (score >= 70) {
    return 'high';
  }

  if (score >= 40) {
    return 'medium';
  }

  if (score > 0) {
    return 'low';
  }

  return 'info';
}

function resolveRiskDecision(
  score: number,
  signals: RiskSignal[],
  thresholds: RiskThresholds,
): RiskDecision {
  const forced = signals
    .map((signal) => signal.decision)
    .filter(Boolean)
    .reduce<RiskDecision>((highest, current) => {
      if (!current) {
        return highest;
      }

      return DECISION_ORDER[current] > DECISION_ORDER[highest]
        ? current
        : highest;
    }, 'allow');

  if (forced !== 'allow') {
    return forced;
  }

  if (score >= thresholds.deny) {
    return 'deny';
  }

  if (score >= thresholds.review) {
    return 'review';
  }

  if (score >= thresholds.challenge) {
    return 'challenge';
  }

  return 'allow';
}

function getRequiredActions(
  decision: RiskDecision,
  signals: RiskSignal[],
): string[] {
  if (decision === 'allow') {
    return [];
  }

  const actions = new Set<string>();

  if (signals.some((signal) => signal.code === 'RATE_LIMIT_EXCEEDED')) {
    actions.add('cooldown');
  }

  if (
    signals.some(
      (signal) =>
        signal.code.includes('TELEGRAM') ||
        signal.code === 'MISSING_APP_SESSION' ||
        signal.code === 'MISSING_USER_SESSION',
    )
  ) {
    actions.add('refresh_session');
  }

  if (
    signals.some(
      (signal) =>
        signal.code.includes('WALLET') ||
        signal.code.includes('TON_PROOF') ||
        signal.code.includes('MINT'),
    )
  ) {
    actions.add('wallet_proof');
  }

  if (decision === 'review') {
    actions.add('manual_review');
  }

  if (decision === 'deny') {
    actions.add('block_request');
  }

  if (decision === 'challenge' && actions.size === 0) {
    actions.add('confirm_action');
  }

  return Array.from(actions);
}

function pushSignal(signals: RiskSignal[], signal: RiskSignal): void {
  signals.push({
    ...signal,
    score: Math.min(100, Math.max(0, Math.round(signal.score))),
  });
}

function requiresUser(action: RiskAction): boolean {
  if (
    action === 'auth.telegram' ||
    action === 'telegram.webhook' ||
    action === 'cron.job'
  ) {
    return false;
  }

  if (String(action).startsWith('admin.')) {
    return false;
  }

  if (String(action).startsWith('cron.')) {
    return false;
  }

  return true;
}

function requiresSession(action: RiskAction): boolean {
  if (
    action === 'auth.telegram' ||
    action === 'telegram.webhook' ||
    action === 'cron.job'
  ) {
    return false;
  }

  if (String(action).startsWith('admin.')) {
    return false;
  }

  if (String(action).startsWith('cron.')) {
    return false;
  }

  return true;
}

function isMachineAction(action: RiskAction): boolean {
  return (
    action === 'telegram.webhook' ||
    action === 'cron.job' ||
    String(action).startsWith('cron.') ||
    String(action).startsWith('admin.')
  );
}

function isGachaAction(action: RiskAction): boolean {
  return (
    action === 'box.create_open_order' ||
    action === 'box.result' ||
    action === 'box.history' ||
    String(action).startsWith('gacha.')
  );
}

function isMarketAction(action: RiskAction): boolean {
  return action === 'market.buy' || String(action).startsWith('market.');
}

function isInventoryAction(action: RiskAction): boolean {
  return String(action).startsWith('inventory.');
}

function isTaskAction(action: RiskAction): boolean {
  return String(action).startsWith('tasks.');
}

function isWalletAction(action: RiskAction): boolean {
  return String(action).startsWith('wallet.');
}

function getString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function getNumber(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getBoolean(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = metadata?.[key];

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }

    if (value.toLowerCase() === 'false') {
      return false;
    }
  }

  return undefined;
}

function sameId(a: string | number, b: string | number): boolean {
  return String(a).trim() === String(b).trim();
}

function normalizeSeverity(
  value: unknown,
  fallback: RiskSeverity,
): RiskSeverity {
  if (
    value === 'info' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'critical'
  ) {
    return value;
  }

  return fallback;
}

function getEnv(name: string): string | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }

  return process.env[name];
}