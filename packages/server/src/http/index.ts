import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  findRoute,
  findRouteByPath,
  type Gateway,
  type RouteDefinition,
} from "@pokepets/contracts";
import { z } from "zod";

import { runScheduledJob } from "../jobs/index.ts";
import { executeModule, queryModule } from "../modules/repository.ts";
import { rpc } from "../platform/db/index.ts";
import { getEnv } from "../platform/env/index.ts";
import {
  resolveSession,
  issueToken,
  referralCode,
  type Session,
} from "../platform/session.ts";
import {
  answerPreCheckout,
  createInvoiceLink,
} from "../platform/telegram/bot.ts";
import { verifyTelegramInitData } from "../platform/telegram/initData.ts";
import { signMintPermit, type MintPermit } from "../platform/ton/permit.ts";
import { verifyTonProof } from "../platform/ton/tonConnect.ts";
import { resolveVerifiedTonWalletPublicKey } from "../platform/ton/walletPublicKey.ts";
import { ApiError, normalizeError } from "./errors.ts";

type OperationEnvelope = {
  operation_id: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  result: Record<string, unknown> | null;
  error_code: string | null;
};
type HandlerResult = {
  data: unknown;
  operationId?: string | null;
  status?: number;
};

const walletProofSchema = z.object({
  account: z.object({
    address: z.string().min(1),
    chain: z.string().optional(),
    publicKey: z.string().optional(),
    walletStateInit: z.string().optional(),
  }),
  proof: z.object({
    timestamp: z.number().int().positive(),
    domain: z.object({
      lengthBytes: z.number().int().positive(),
      value: z.string().min(1),
    }),
    payload: z.string().min(1),
    signature: z.string().min(1),
  }),
  wallet_app_name: z.string().max(128).optional(),
  walletAppName: z.string().max(128).optional(),
});

export function createGateway(
  gateway: Gateway,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    let route: RouteDefinition | null = null;
    try {
      const url = new URL(request.url);
      const pathname = requestedPath(url, gateway);
      const match = findRoute(request.method, pathname, gateway);
      if (!match) {
        route = findRouteByPath(pathname, gateway);
        if (route)
          throw new ApiError(405, "METHOD_NOT_ALLOWED", "请求方法不支持");
        throw new ApiError(404, "API_ROUTE_NOT_FOUND", "接口不存在");
      }
      route = match.route;
      if (gateway === "jobs") verifyCron(request);
      if (gateway === "integrations") verifyWebhook(request);
      const rawInput = await readInput(request, url, match.params);
      const parsed = match.route.input.safeParse(rawInput);
      if (!parsed.success)
        throw new ApiError(400, "REQUEST_INVALID", "请求参数无效", false, {
          issues: parsed.error.issues,
        });
      const session = match.route.auth ? await resolveSession(request) : null;
      const result = await dispatch(match.route, parsed.data, session, request);
      return success(match.route, result, requestId, Date.now() - startedAt);
    } catch (cause) {
      return failure(
        normalizeError(cause),
        requestId,
        route?.compatibility ?? "c2",
      );
    }
  };
}

async function dispatch(
  route: RouteDefinition,
  input: unknown,
  session: Session | null,
  request: Request,
): Promise<HandlerResult> {
  const legacyInput = input as Record<string, unknown>;
  const legacyIdempotencyKey =
    route.compatibility === "c1"
      ? (legacyInput.idempotencyKey ?? legacyInput.idempotency_key)
      : null;
  const idempotencyKey =
    request.headers.get("idempotency-key") ??
    (typeof legacyIdempotencyKey === "string" ? legacyIdempotencyKey : null);
  if (route.idempotent && !idempotencyKey)
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键");
  if (
    route.idempotent &&
    route.compatibility !== "c1" &&
    !z.string().uuid().safeParse(idempotencyKey).success
  )
    throw new ApiError(400, "IDEMPOTENCY_KEY_INVALID", "幂等键必须是 UUID");
  if (route.id === "health")
    return {
      data: {
        status: "ok",
        service: "tma-game-api",
        timestamp: new Date().toISOString(),
      },
    };
  if (route.id === "auth.telegram") return authenticate(input, request);
  if (route.id === "telegram.payment_support")
    return {
      data: {
        configured: true,
        supportEmail: null,
        supportUrl: getEnv().PAYMENT_SUPPORT_URL,
        serverTime: new Date().toISOString(),
      },
    };
  if (route.id === "telegram.webhook") return handleWebhook(input);
  if (route.id.startsWith("jobs.")) return runJob(route.id);
  if (route.id === "wallet.challenge")
    return walletChallenge(requireUser(session));
  if (route.id === "wallet.connect")
    return walletConnect(requireUser(session), input, idempotencyKey ?? "");
  if (route.id === "wallet.proof")
    return walletProof(requireUser(session), input, idempotencyKey ?? "");
  if (route.id === "nft.metadata")
    return { data: await queryModule(route.id, null, input) };
  if (route.method === "GET") {
    const queryInput = route.id.startsWith("tasks.")
      ? {
          ...(input as Record<string, unknown>),
          bot_username: getEnv().TELEGRAM_BOT_USERNAME,
          mini_app_short_name: getEnv().TELEGRAM_MINI_APP_SHORT_NAME,
        }
      : input;
    return {
      data: await queryModule(
        route.id,
        route.auth ? requireUser(session) : null,
        queryInput,
      ),
    };
  }

  if (
    route.id === "wallet.mint" &&
    (input as { action?: string }).action === "submit"
  ) {
    const submitted = input as { mint_id: string; transaction_hash: string };
    const data = await rpc<{ operation_id: string } & Record<string, unknown>>(
      "mark_mint_submitted",
      {
        p_user_id: requireUser(session),
        p_mint_id: submitted.mint_id,
        p_transaction_hash: submitted.transaction_hash,
      },
    );
    return { data, operationId: data.operation_id, status: 202 };
  }
  if (
    route.id === "wallet.mint" &&
    (input as { action?: string }).action === "cancel"
  ) {
    const cancelled = input as { mint_id: string };
    const data = await rpc<{ operation_id: string } & Record<string, unknown>>(
      "cancel_mint",
      { p_user_id: requireUser(session), p_mint_id: cancelled.mint_id },
    );
    return { data, operationId: data.operation_id };
  }
  const executeInput =
    route.id === "wallet.mint"
      ? { template_id: (input as { template_id: string }).template_id }
      : route.id === "tasks.bind_referral"
        ? {
            ...(input as Record<string, unknown>),
            session_id: session?.session_id,
          }
        : input;
  const operation = await executeModule<OperationEnvelope>(
    route.id,
    requireUser(session),
    idempotencyKey ?? "",
    executeInput,
  );
  if (operation.status === "failed") {
    const message =
      typeof operation.result?.message === "string"
        ? operation.result.message
        : "操作失败";
    throw new ApiError(
      409,
      operation.error_code ?? "OPERATION_FAILED",
      message,
      false,
      undefined,
      operation.operation_id,
    );
  }
  let data: unknown = operation.result ?? { status: operation.status };
  if (
    (route.id === "topup.create_order" || route.id === "vip.create_order") &&
    operation.result
  ) {
    const stars = Number(operation.result.stars_amount);
    const invoicePayload = String(operation.result.invoice_payload);
    const invoiceUrl = await createInvoiceLink({
      title:
        route.id === "vip.create_order"
          ? "PokePets VIP 月卡"
          : `充值 ${stars} K-coin`,
      description:
        route.id === "vip.create_order"
          ? "30 个 UTC 自然日的 PokePets VIP 权益"
          : `${stars} Telegram Stars 兑换 ${stars} K-coin`,
      payload: invoicePayload,
      stars,
    });
    data = { ...operation.result, invoice_url: invoiceUrl };
  }
  if (route.id === "wallet.mint" && operation.result) {
    const permit = operation.result as unknown as MintPermit;
    data = {
      ...operation.result,
      ...signMintPermit(permit),
      collection_address: getEnv().TON_COLLECTION_ADDRESS,
    };
  }
  return {
    data,
    operationId: operation.operation_id,
    status:
      operation.status === "pending" || operation.status === "unknown"
        ? 202
        : 200,
  };
}

async function authenticate(
  input: unknown,
  request: Request,
): Promise<HandlerResult> {
  const body = input as { init_data: string };
  const source =
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  await rpc("check_auth_rate_limit", {
    p_key_hash: createHashHex(`source:${source}`),
    p_limit: 30,
  });
  const verified = verifyTelegramInitData(body.init_data, {
    botToken: getEnv().TELEGRAM_BOT_TOKEN,
  });
  if (verified.user.is_bot)
    throw new ApiError(
      401,
      "TELEGRAM_USER_INVALID",
      "Telegram 登录校验失败，请重新进入应用",
    );
  await Promise.all([
    rpc("check_auth_rate_limit", {
      p_key_hash: createHashHex(`user:${verified.user.id}`),
      p_limit: 10,
    }),
    rpc("check_auth_rate_limit", {
      p_key_hash: createHashHex(`init:${body.init_data}`),
      p_limit: 3,
    }),
  ]);
  const issued = issueToken();
  const data = await rpc<{
    session_id: string;
    user_id: string;
    account_status: "normal" | "banned";
    expires_at: string;
  }>("create_telegram_session", {
    p_telegram_id: verified.user.id,
    p_username: verified.user.username ?? null,
    p_first_name: verified.user.first_name,
    p_last_name: verified.user.last_name ?? null,
    p_language_code: verified.user.language_code ?? null,
    p_referral_code: referralCode(verified.user.id),
    p_token_hash: issued.hash,
    p_auth_date: verified.authDate.toISOString(),
    p_expires_at: issued.expiresAt.toISOString(),
    p_start_param: verified.startParam ?? null,
  });
  return {
    data: {
      access_token: issued.token,
      expires_at: data.expires_at,
      user_id: data.user_id,
      account_status: data.account_status,
      start_param: verified.startParam ?? null,
    },
  };
}

function createHashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function walletChallenge(userId: string): Promise<HandlerResult> {
  const challenge = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await rpc<Record<string, unknown>>("create_wallet_challenge", {
    p_user_id: userId,
    p_challenge: challenge,
    p_expires_at: expiresAt.toISOString(),
  });
  return {
    data: {
      challenge,
      ton_proof_payload: challenge,
      tonProofPayload: challenge,
      expires_at: expiresAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      server_time: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    },
  };
}

async function walletConnect(
  userId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<HandlerResult> {
  const operation = await executeModule<OperationEnvelope>(
    "wallet.connect",
    userId,
    idempotencyKey,
    input,
  );
  if (operation.status === "failed")
    throw new ApiError(
      409,
      operation.error_code ?? "OPERATION_FAILED",
      "连接钱包失败",
      false,
      undefined,
      operation.operation_id,
    );
  if (!operation.result)
    throw new ApiError(
      500,
      "WALLET_CONNECT_RESULT_INVALID",
      "钱包连接结果无效",
    );
  return { data: operation.result, operationId: operation.operation_id };
}

async function walletProof(
  userId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<HandlerResult> {
  const body = walletProofSchema.parse(input);
  const verified = await verifyTonProof({
    account: body.account,
    proof: body.proof,
    expectedDomain: new URL(getEnv().APP_BASE_URL).hostname,
    expectedPayload: body.proof.payload,
    resolvePublicKey: resolveVerifiedTonWalletPublicKey,
  });
  const result = await rpc<Record<string, unknown>>("save_verified_wallet", {
    p_user_id: userId,
    p_challenge: body.proof.payload,
    p_address: verified.address,
    p_network: verified.network,
    p_wallet_app_name: body.wallet_app_name ?? body.walletAppName ?? null,
    p_public_key: verified.walletPublicKey,
    p_idempotency_key: idempotencyKey,
  });
  return {
    data: {
      connected: true,
      verified: true,
      status: "verified",
      address: result.address ?? verified.address,
      walletId: result.wallet_id ?? null,
      chain: verified.network.toUpperCase(),
      network: verified.network,
      verifiedAt: result.verified_at,
    },
    operationId:
      typeof result.operation_id === "string" ? result.operation_id : null,
  };
}

async function handleWebhook(input: unknown): Promise<HandlerResult> {
  const update = input as Record<string, unknown>;
  const eventId = String(update.update_id ?? "");
  const preCheckout = update.pre_checkout_query as
    | Record<string, unknown>
    | undefined;
  if (preCheckout) {
    const valid = await rpc<{ valid: boolean; payment_id: string } | null>(
      "validate_payment",
      {
        p_invoice_payload: preCheckout.invoice_payload,
        p_stars: preCheckout.total_amount,
      },
    );
    await answerPreCheckout(
      String(preCheckout.id),
      Boolean(valid?.valid),
      valid?.valid ? undefined : "订单已失效，请重新发起支付",
    );
    return {
      data: {
        handled: true,
        event_type: "pre_checkout_query",
        allowed: Boolean(valid?.valid),
        answered: true,
        idempotent: true,
        event_id: eventId || null,
        star_order_id: valid?.payment_id ?? null,
        draw_order_id: null,
        reason_code: valid?.valid ? null : "PAYMENT_ORDER_INVALID",
        payment_order_status: valid?.valid ? "pending" : null,
      },
    };
  }
  const message = update.message as Record<string, unknown> | undefined;
  const successful = message?.successful_payment as
    | Record<string, unknown>
    | undefined;
  if (successful) {
    const data = await rpc("apply_successful_payment", {
      p_event_id: eventId,
      p_invoice_payload: successful.invoice_payload,
      p_telegram_charge_id: successful.telegram_payment_charge_id,
      p_provider_charge_id: successful.provider_payment_charge_id ?? null,
      p_stars: successful.total_amount,
      p_payload: update,
    });
    const payment = data as Record<string, unknown>;
    return {
      data: {
        handled: true,
        event_type: "successful_payment",
        payment_recorded: !payment.duplicate,
        duplicate_update: Boolean(payment.duplicate),
        duplicate_charge: Boolean(payment.duplicate),
        event_id: eventId || null,
        idempotent: Boolean(payment.duplicate),
        star_order_id: payment.payment_id ?? null,
        star_payment_id: successful.telegram_payment_charge_id ?? null,
        draw_order_id: null,
        reason_code: null,
        payment_order_status: payment.status ?? null,
        process_status: "processed",
        fulfillment_attempted: true,
        fulfillment_status: payment.status ?? "paid",
        fulfillment_idempotent: Boolean(payment.duplicate),
        fulfillment_reason_code: null,
        fulfillment_retryable: payment.status === "paid",
      },
    };
  }
  const refund = message?.refunded_payment as
    | Record<string, unknown>
    | undefined;
  if (refund) {
    const data = await rpc("apply_refund", {
      p_event_id: eventId,
      p_telegram_charge_id: refund.telegram_payment_charge_id,
      p_stars: refund.total_amount,
      p_payload: update,
    });
    return {
      data: {
        handled: true,
        event_type: "refunded_payment",
        event_id: eventId || null,
        result: data,
      },
    };
  }
  return {
    data: {
      handled: false,
      event_type: "unsupported",
      event_id: eventId || null,
      received_event_id: eventId || null,
      process_status: "ignored",
    },
  };
}

async function runJob(routeId: string): Promise<HandlerResult> {
  const name = routeId.slice("jobs.".length).replaceAll("_", "-");
  return { data: await runScheduledJob(name) };
}

function requestedPath(url: URL, gateway: Gateway): string {
  const routed = url.searchParams.get("__route");
  if (routed) return `/api/${routed.replace(/^\/+/, "")}`;
  if (gateway === "integrations") return "/api/telegram/webhook";
  return url.pathname;
}

async function readInput(
  request: Request,
  url: URL,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const input =
    request.method === "GET"
      ? Object.fromEntries(
          [...url.searchParams.entries()].filter(([key]) => key !== "__route"),
        )
      : await readJson(request);
  return { ...input, ...params };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ApiError(400, "REQUEST_INVALID", "请求体必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}

function requireUser(session: Session | null): string {
  if (!session)
    throw new ApiError(
      401,
      "SESSION_REQUIRED",
      "请从 Telegram 重新打开 Mini App",
    );
  if (session.account_status === "banned")
    throw new ApiError(403, "ACCOUNT_RESTRICTED", "账号不可用");
  return session.user_id;
}

function verifyCron(request: Request): void {
  if (request.headers.get("authorization") !== `Bearer ${getEnv().CRON_SECRET}`)
    throw new ApiError(401, "CRON_UNAUTHORIZED", "后台任务认证失败");
}

function verifyWebhook(request: Request): void {
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !==
    getEnv().TELEGRAM_WEBHOOK_SECRET
  )
    throw new ApiError(401, "WEBHOOK_UNAUTHORIZED", "Webhook 认证失败");
}

function success(
  route: RouteDefinition,
  result: HandlerResult,
  requestId: string,
  elapsedMs: number,
): Response {
  const headers = responseHeaders(requestId);
  if (route.id === "nft.metadata") {
    headers.set("cache-control", "public, max-age=31536000, immutable");
    return Response.json(result.data, {
      status: result.status ?? 200,
      headers,
    });
  }
  if (route.compatibility === "c1") {
    const data =
      route.id === "health" && result.data && typeof result.data === "object"
        ? { ...(result.data as Record<string, unknown>), requestId }
        : result.data;
    return Response.json(
      {
        ok: true,
        success: true,
        data,
        meta: { requestId, elapsedMs },
        requestId,
        request_id: requestId,
      },
      { status: result.status ?? 200, headers },
    );
  }
  return Response.json(
    {
      data: result.data,
      request_id: requestId,
      operation_id: result.operationId ?? null,
    },
    { status: result.status ?? 200, headers },
  );
}

function failure(
  error: ApiError,
  requestId: string,
  compatibility: RouteDefinition["compatibility"],
): Response {
  const headers = responseHeaders(requestId);
  if (compatibility === "c1") {
    return Response.json(
      {
        ok: false,
        success: false,
        error: {
          code: error.code,
          message:
            error.status >= 500 ? "Internal server error" : error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        requestId,
        request_id: requestId,
      },
      { status: error.status, headers },
    );
  }
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
      request_id: requestId,
      operation_id: error.operationId,
    },
    { status: error.status, headers },
  );
}

function responseHeaders(requestId: string): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
}
