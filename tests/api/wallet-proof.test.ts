import { createPrivateKey, sign } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import {
  buildTonProofDigest,
  parseRawTonAddress,
} from "../../packages/server/src/ton/tonConnect";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, getSupabaseAdminClientMock, requireSessionMock } =
  vi.hoisted(() => ({
    callRpcRawMock: vi.fn(),
    getSupabaseAdminClientMock: vi.fn(),
    requireSessionMock: vi.fn(),
  }));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
  RpcError: class RpcError extends Error {},
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROOF_ID = "22222222-2222-4222-8222-222222222222";
const WALLET_ID = "33333333-3333-4333-8333-333333333333";
const CHALLENGE = "wallet-proof-challenge-0001";
const DOMAIN = "app.example.com";
const RAW_ADDRESS =
  "0:676898db2fc6d59bc0590be076943831b0a27fa0441b194846b4327d96aea388";
const WALLET_PUBLIC_KEY =
  "95aac656e719d06b884b104968ee919afac71b5038f5b55a7e32b2dc4023d1f8";
const WALLET_STATE_INIT =
  "te6cckECFgEAAwQAAgE0ARUBFP8A9KQT9LzyyAsCAgEgAxACAUgEBwLm0AHQ0wMhcbCSXwTgItdJwSCSXwTgAtMfIYIQcGx1Z70ighBkc3RyvbCSXwXgA/pAMCD6RAHIygfL/8nQ7UTQgQFA1yH0BDBcgQEI9ApvoTGzkl8H4AXTP8glghBwbHVnupI4MOMNA4IQZHN0crqSXwbjDQUGAHgB+gD0BDD4J28iMFAKoSG+8uBQghBwbHVngx6xcIAYUATLBSbPFlj6Ahn0AMtpF8sfUmDLPyDJgED7AAYAilAEgQEI9Fkw7UTQgQFA1yDIAc8W9ADJ7VQBcrCOI4IQZHN0coMesXCAGFAFywVQA88WI/oCE8tqyx/LP8mAQPsAkl8D4gIBIAgPAgEgCQ4CAVgKCwA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIAwNABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AABG4yX7UTQ1wsfgAWb0kK29qJoQICga5D6AhhHDUCAhHpJN9KZEM5pA+n/mDeBKAG3gQFImHFZ8xhAT48oMI1xgg0x/TH9MfAvgju/Jk7UTQ0x/TH9P/9ATRUUO68qFRUbryogX5AVQQZPkQ8qP4ACSkyMsfUkDLH1Iwy/9SEPQAye1U+A8B0wchwACfbFGTINdKltMH1AL7AOgw4CHAAeMAIcAC4wABwAORMOMNA6TIyx8Syx/L/xESExQAbtIH+gDU1CL5AAXIygcVy//J0Hd0gBjIywXLAiLPFlAF+gIUy2sSzMzJc/sAyEAUgQEI9FHypwIAcIEBCNcY+gDTP8hUIEeBAQj0UfKnghBub3RlcHSAGMjLBcsCUAbPFlAE+gIUy2oSyx/LP8lz+wACAGyBAQjXGPoA0z8wUiSBAQj0WfKnghBkc3RycHSAGMjLBcsCUAXPFlAD+gITy2rLHxLLP8lz+wAACvQAye1UAFEAAAAAKamjF5WqxlbnGdBriEsQSWjukZr6xxtQOPW1Wn4ystxAI9H4QEc5mKQ=";
const WALLET_PRIVATE_KEY_JWK = {
  crv: "Ed25519",
  d: "YVau-JwBmiNk26E2aPlr9zlsGqOy-kxDk4RpdOTtZ8s",
  x: "larGVucZ0GuISxBJaO6RmvrHG1A49bVafjKy3EAj0fg",
  kty: "OKP",
} as const;

type QueryState = {
  schema: string;
  table: string;
  operation: "insert" | "select" | "update" | null;
  payload: unknown;
  selected: string | null;
  filters: Array<{
    method: "eq" | "is" | "gt";
    column: string;
    value: unknown;
  }>;
};

type QueryResult = {
  data: unknown;
  error: unknown;
};

type QueryResultFactory = (state: QueryState) => QueryResult;

describe("wallet challenge API", () => {
  beforeEach(() => {
    resetTestEnv();
  });

  it("creates a pending wallet proof challenge for the session user", async () => {
    const db = createSupabaseMock([
      (state) => ({
        data: {
          id: PROOF_ID,
          challenge: readPayloadField(state.payload, "challenge"),
          expires_at: readPayloadField(state.payload, "expires_at"),
        },
        error: null,
      }),
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: challengeHandler } =
      await import("../../api/wallet/challenge");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      challengeHandler,
      {
        method: "POST",
        url: "/api/wallet/challenge",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-request-id": "req-wallet-challenge",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        ton_proof_payload: expect.any(String),
        tonProofPayload: expect.any(String),
        expires_at: "2026-05-28T12:05:00.000Z",
      },
    });
    expect(db.queries[0]).toMatchObject({
      schema: "core",
      table: "wallet_proofs",
      operation: "insert",
    });
    expect(db.queries[0]?.payload).toMatchObject({
      user_id: USER_ID,
      status: "pending",
      request_id: "req-wallet-challenge",
      expires_at: "2026-05-28T12:05:00.000Z",
    });
  });
});

describe("wallet proof API", () => {
  beforeEach(() => {
    resetTestEnv();
  });

  it("verifies a valid ton_proof, saves the wallet through RPC, and marks proof verified", async () => {
    const proofPayload = await createSignedProof();
    const db = createSupabaseMock([
      {
        data: createWalletProofRow(),
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);
    callRpcRawMock.mockResolvedValue({
      wallet_id: WALLET_ID,
      address: proofPayload.account.address,
      network: "mainnet",
    });

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiSuccessResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
        "x-request-id": "req-wallet-proof",
      },
      body: {
        ...proofPayload,
        wallet_app_name: "Tonkeeper",
        idempotency_key: "wallet:proof:test-0001",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        verified: true,
        connected: true,
        status: "verified",
        address: RAW_ADDRESS,
        chain: "MAINNET",
        network: "mainnet",
        walletId: WALLET_ID,
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "wallet_save_verified_address",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_address: RAW_ADDRESS,
        p_address_raw: RAW_ADDRESS,
        p_network: "mainnet",
        p_wallet_app_name: "Tonkeeper",
        p_is_primary: true,
      }),
      expect.objectContaining({
        schema: "api",
      }),
    );
    expect(db.queries[0]).toMatchObject({
      table: "wallet_proofs",
      operation: "update",
      selected: "id,user_id,wallet_id,challenge,status,expires_at,used_at",
    });
    expect(db.queries[0]?.filters).toEqual(
      expect.arrayContaining([
        { method: "eq", column: "user_id", value: USER_ID },
        { method: "eq", column: "challenge", value: CHALLENGE },
        { method: "eq", column: "status", value: "pending" },
        { method: "is", column: "used_at", value: null },
      ]),
    );
    expect(db.queries[1]?.payload).toMatchObject({
      status: "verified",
      wallet_id: WALLET_ID,
      error_message: null,
      wallet_public_key: WALLET_PUBLIC_KEY,
    });
  });

  it("rejects a proof when wallet stateInit does not derive the submitted address", async () => {
    const proofPayload = await createSignedProof({
      address: `0:${"22".repeat(32)}`,
    });
    const db = createSupabaseMock([
      {
        data: createWalletProofRow(),
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:mismatch-0001",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_PROOF_INVALID",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(db.queries[1]?.payload).toMatchObject({
      status: "failed",
      error_message: "WALLET_PROOF_INVALID",
    });
  });

  it("rejects a proof for the wrong domain and marks it failed", async () => {
    const proofPayload = await createSignedProof({
      domain: "evil.example.com",
    });
    const db = createSupabaseMock([
      {
        data: createWalletProofRow(),
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:wrong-domain-0001",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_PROOF_INVALID",
        details: {
          reason: "TON_PROOF_DOMAIN_MISMATCH",
        },
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(db.queries[1]?.payload).toMatchObject({
      status: "failed",
      error_message: "WALLET_PROOF_INVALID",
    });
  });

  it("rejects a proof with the wrong signature and marks it failed", async () => {
    const proofPayload = await createSignedProof({
      signature: Buffer.alloc(64, 7).toString("base64"),
    });
    const db = createSupabaseMock([
      {
        data: createWalletProofRow(),
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:wrong-signature-0001",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_PROOF_INVALID",
        details: {
          reason: "TON_PROOF_SIGNATURE_INVALID",
        },
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(db.queries[1]?.payload).toMatchObject({
      status: "failed",
      error_message: "WALLET_PROOF_INVALID",
    });
  });

  it("rejects an expired ton_proof timestamp and never saves a verified wallet", async () => {
    const proofPayload = await createSignedProof({
      timestamp: Math.floor(
        new Date("2026-05-28T11:54:59.000Z").getTime() / 1000,
      ),
    });
    const db = createSupabaseMock([
      {
        data: createWalletProofRow(),
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:expired-timestamp-0001",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_PROOF_EXPIRED",
        details: {
          reason: "TON_PROOF_EXPIRED",
        },
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(db.queries[1]?.payload).toMatchObject({
      status: "failed",
      error_message: "WALLET_PROOF_EXPIRED",
    });
  });

  it("rejects an expired challenge and marks it expired without calling RPC", async () => {
    const proofPayload = await createSignedProof();
    const db = createSupabaseMock([
      {
        data: null,
        error: null,
      },
      {
        data: createWalletProofRow({
          expires_at: "2026-05-28T11:59:00.000Z",
        }),
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:expired-0001",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_PROOF_EXPIRED",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(db.queries[2]?.payload).toMatchObject({
      status: "expired",
      error_message: "expired",
    });
  });

  it("fails closed when the expected proof domain is not configured", async () => {
    delete process.env.TON_PROOF_DOMAIN;
    delete process.env.PUBLIC_APP_URL;
    delete process.env.TONCONNECT_MANIFEST_URL;
    delete process.env.VERCEL_URL;

    const proofPayload = await createSignedProof();
    const db = createSupabaseMock([]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
        host: DOMAIN,
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:domain-missing-0001",
      },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "SERVER_CONFIG_ERROR",
        message: "Internal server error",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(0);
  });

  it("rejects an already used challenge as replay", async () => {
    const proofPayload = await createSignedProof();
    const db = createSupabaseMock([
      {
        data: null,
        error: null,
      },
      {
        data: createWalletProofRow({
          status: "verified",
          used_at: "2026-05-28T12:00:01.000Z",
        }),
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:replay-0001",
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_PROOF_REPLAYED",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects a duplicate proof hash unique violation as replay", async () => {
    const proofPayload = await createSignedProof();
    const db = createSupabaseMock([
      {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "wallet_proofs_proof_hash_unique_idx"',
        },
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: proofHandler } = await import("../../api/wallet/proof");
    const result = await invokeApiHandler<ApiErrorResponse>(proofHandler, {
      method: "POST",
      url: "/api/wallet/proof",
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
      },
      body: {
        ...proofPayload,
        idempotencyKey: "wallet:proof:hash-replay-0001",
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_PROOF_REPLAYED",
      },
    });
    expect(db.queries[0]).toMatchObject({
      table: "wallet_proofs",
      operation: "update",
      payload: expect.objectContaining({
        proof_hash: expect.any(String),
      }),
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

async function createSignedProof(
  options: {
    address?: string;
    domain?: string;
    signature?: string;
    timestamp?: number;
    walletStateInit?: string;
  } = {},
): Promise<{
  account: {
    address: string;
    chain: string;
    publicKey: string;
    walletStateInit: string;
  };
  proof: {
    timestamp: number;
    domain: {
      lengthBytes: number;
      value: string;
    };
    payload: string;
    signature: string;
  };
  challenge: string;
}> {
  const privateKey = createPrivateKey({
    key: WALLET_PRIVATE_KEY_JWK,
    format: "jwk",
  });
  const address = options.address ?? RAW_ADDRESS;
  const domain = options.domain ?? DOMAIN;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const messageHash = buildTonProofDigest(parseRawTonAddress(address), {
    timestamp,
    domain: {
      lengthBytes: Buffer.byteLength(domain, "utf8"),
      value: domain,
    },
    payload: CHALLENGE,
    signature: "",
  });
  const signature =
    options.signature ?? sign(null, messageHash, privateKey).toString("base64");

  return {
    account: {
      address,
      chain: "-239",
      publicKey: WALLET_PUBLIC_KEY,
      walletStateInit: options.walletStateInit ?? WALLET_STATE_INIT,
    },
    proof: {
      timestamp,
      domain: {
        lengthBytes: Buffer.byteLength(domain, "utf8"),
        value: domain,
      },
      payload: CHALLENGE,
      signature,
    },
    challenge: CHALLENGE,
  };
}

function createWalletProofRow(
  overrides: Partial<WalletProofTestRow> = {},
): WalletProofTestRow {
  return {
    id: PROOF_ID,
    user_id: USER_ID,
    wallet_id: null,
    challenge: CHALLENGE,
    status: "pending",
    expires_at: "2026-05-28T12:05:00.000Z",
    used_at: null,
    ...overrides,
  };
}

function createSupabaseMock(results: Array<QueryResult | QueryResultFactory>) {
  const queries: QueryState[] = [];
  let queryIndex = 0;

  const client = {
    schema(schema: string) {
      return {
        from(table: string) {
          const state: QueryState = {
            schema,
            table,
            operation: null,
            payload: null,
            selected: null,
            filters: [],
          };
          queries.push(state);

          const resolveNextResult = async (): Promise<QueryResult> => {
            const result = results[queryIndex] ?? {
              data: null,
              error: null,
            };
            queryIndex += 1;

            return typeof result === "function" ? result(state) : result;
          };

          const builder = {
            insert(payload: unknown) {
              state.operation = "insert";
              state.payload = payload;
              return builder;
            },
            update(payload: unknown) {
              state.operation = "update";
              state.payload = payload;
              return builder;
            },
            select(columns: string) {
              state.operation ??= "select";
              state.selected = columns;
              return builder;
            },
            eq(column: string, value: unknown) {
              state.filters.push({
                method: "eq",
                column,
                value,
              });
              return builder;
            },
            is(column: string, value: unknown) {
              state.filters.push({
                method: "is",
                column,
                value,
              });
              return builder;
            },
            gt(column: string, value: unknown) {
              state.filters.push({
                method: "gt",
                column,
                value,
              });
              return builder;
            },
            single: resolveNextResult,
            maybeSingle: resolveNextResult,
            then<TResult1 = QueryResult, TResult2 = never>(
              onfulfilled?:
                | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null,
            ) {
              return resolveNextResult().then(onfulfilled, onrejected);
            },
          };

          return builder;
        },
      };
    },
  };

  return {
    client,
    queries,
  };
}

function resetTestEnv(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
  vi.resetModules();
  callRpcRawMock.mockReset();
  getSupabaseAdminClientMock.mockReset();
  requireSessionMock.mockReset();
  requireSessionMock.mockResolvedValue({
    sessionId: "session-wallet-proof-test",
    userId: USER_ID,
    telegramUserId: 7001,
    userStatus: "active",
    expiresAt: "2026-05-29T00:00:00.000Z",
    sessionTokenHash: "session-hash",
  });
  process.env.TON_NETWORK = "mainnet";
  process.env.PUBLIC_APP_URL = `https://${DOMAIN}`;
  process.env.TON_PROOF_TTL_SECONDS = "300";
  process.env.TON_PROOF_CHALLENGE_BYTES = "32";
}

function readPayloadField(payload: unknown, field: string): unknown {
  return isRecord(payload) ? payload[field] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type WalletProofTestRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  challenge: string;
  status: string;
  expires_at: string;
  used_at: string | null;
};
