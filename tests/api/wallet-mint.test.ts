import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const {
  assertMintApiEnabledMock,
  callRpcRawMock,
  getSupabaseAdminClientMock,
  requireSessionMock,
  withIdempotencyMock,
} = vi.hoisted(() => ({
  assertMintApiEnabledMock: vi.fn(),
  callRpcRawMock: vi.fn(),
  getSupabaseAdminClientMock: vi.fn(),
  requireSessionMock: vi.fn(),
  withIdempotencyMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("../../packages/server/src/ton/mintGuards.js", () => ({
  assertMintApiEnabled: assertMintApiEnabledMock,
}));

vi.mock("../../packages/server/src/db/idempotency.js", () => {
  class IdempotencyError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details: Record<string, unknown> | undefined;

    constructor(
      message: string,
      options: {
        code: string;
        status?: number;
        details?: Record<string, unknown>;
      },
    ) {
      super(message);
      this.code = options.code;
      this.status = options.status ?? 409;
      this.details = options.details;
    }
  }

  return {
    IdempotencyError,
    withIdempotency: withIdempotencyMock,
  };
});

vi.mock("../../packages/server/src/db/rpc.js", () => {
  class RpcError extends Error {
    readonly rpcName: string;

    constructor(params: { rpcName: string; error?: { message?: string } }) {
      super(
        `Supabase RPC "${params.rpcName}" failed: ${
          params.error?.message ?? "Unknown Supabase RPC error"
        }`,
      );
      this.rpcName = params.rpcName;
    }
  }

  return {
    RpcError,
    callRpcRaw: callRpcRawMock,
  };
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const COLLECTION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const FORM_ID = "66666666-6666-4666-8666-666666666666";
const QUEUE_ID = "77777777-7777-4777-8777-777777777777";
const ADDRESS = `EQ${"A".repeat(46)}`;
const RAW_ADDRESS = `0:${"a".repeat(64)}`;
const OTHER_ADDRESS = `EQ${"B".repeat(46)}`;
const COLLECTION_ADDRESS = `EQ${"C".repeat(46)}`;

let preparePayload: Record<string, unknown>;

describe("wallet mint API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T08:00:00.000Z"));
    delete process.env.TON_COLLECTION_ADDRESS;

    preparePayload = createPreparePayload();
    assertMintApiEnabledMock.mockReset();
    assertMintApiEnabledMock.mockResolvedValue(undefined);
    callRpcRawMock.mockReset();
    callRpcRawMock.mockImplementation(async (rpcName: string) => {
      if (rpcName === "wallet_prepare_mint_request") {
        return preparePayload;
      }

      if (rpcName === "wallet_enqueue_mint") {
        return {
          mint_queue_id: QUEUE_ID,
          status: "queued",
          item_instance_id: ITEM_ID,
          idempotent: false,
        };
      }

      if (rpcName === "wallet_save_mint_metadata_snapshot") {
        return {
          mint_queue_id: QUEUE_ID,
          status: "queued",
          priority: 100,
        };
      }

      throw new Error(`Unexpected RPC ${rpcName}`);
    });
    getSupabaseAdminClientMock.mockReset();
    getSupabaseAdminClientMock.mockReturnValue({});
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-wallet-mint-test",
      userId: USER_ID,
      telegramUserId: 7009,
      userStatus: "active",
      expiresAt: "2026-05-30T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
    withIdempotencyMock.mockReset();
    withIdempotencyMock.mockImplementation(
      async (input: { handler: () => Promise<unknown>; key: string }) => ({
        data: await input.handler(),
        replayed: false,
        scope: "wallet.mint",
        key: input.key,
        requestHash: "request-hash",
        record: {},
      }),
    );
  });

  it("returns a clear error when no active Collection is configured", async () => {
    preparePayload = createPreparePayload({
      collections: [],
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:no-collection"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "NFT_COLLECTION_NOT_CONFIGURED",
        message: "Collection 未配置，暂时无法 Mint。",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a paused Collection before enqueueing", async () => {
    preparePayload = createPreparePayload({
      collections: [
        createCollectionRow({
          status: "paused",
        }),
      ],
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:paused-collection"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "NFT_COLLECTION_PAUSED",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("rejects Collection and wallet network mismatch", async () => {
    process.env.TON_COLLECTION_ADDRESS = COLLECTION_ADDRESS;
    preparePayload = createPreparePayload({
      wallet: createWalletRow({
        network: "testnet",
      }),
      collection: createCollectionRow({
        network: "mainnet",
      }),
      collections: [],
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:network-mismatch"),
      body: {
        item_instance_id: ITEM_ID,
        chain: "TESTNET",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "COLLECTION_NETWORK_MISMATCH",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["collection_id", { collection_id: COLLECTION_ID }],
    ["collectionAddress", { collectionAddress: COLLECTION_ADDRESS }],
    ["metadata", { metadata: { name: "client supplied metadata" } }],
    ["metadata_url", { metadata_url: "https://evil.example/nft.json" }],
    ["metadataMode", { metadataMode: "REFRESH_FROM_CATALOG" }],
    ["priority", { priority: "HIGH" }],
  ])("rejects client-controlled Mint field %s", async (field, extraBody) => {
    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders(`wallet:mint:blocked-${field}`),
      body: {
        item_instance_id: ITEM_ID,
        ...extraBody,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        details: expect.arrayContaining([
          expect.objectContaining({
            path: field,
            code: "CLIENT_CONTROLLED_MINT_FIELD",
          }),
        ]),
      },
    });
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("requires a verified wallet", async () => {
    preparePayload = createPreparePayload({
      wallet: createWalletRow({
        verified_at: null,
      }),
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:unverified-wallet"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_NOT_VERIFIED",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("requires a connected wallet", async () => {
    preparePayload = createPreparePayload({
      wallet: null,
      other_wallet: null,
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:not-connected"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_NOT_CONNECTED",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a target address that is not the verified wallet", async () => {
    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:target-mismatch"),
      body: {
        item_instance_id: ITEM_ID,
        target_address: OTHER_ADDRESS,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "MINT_TARGET_WALLET_MISMATCH",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an item that is not owned by the session user", async () => {
    preparePayload = createPreparePayload({
      item: null,
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:not-owner"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(404);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "ITEM_NOT_FOUND",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it.each(["listed", "consumed", "decomposed"] as const)(
    "rejects a %s item before enqueueing",
    async (status) => {
      preparePayload = createPreparePayload({
        item: createItemRow({
          status,
        }),
      });

      const { default: mintHandler } = await import("../../api/wallet/mint");
      const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
        method: "POST",
        url: "/api/wallet/mint",
        headers: requestHeaders(`wallet:mint:item-${status}`),
        body: {
          item_instance_id: ITEM_ID,
        },
      });

      expect(result.statusCode).toBe(409);
      expect(result.body).toMatchObject({
        ok: false,
        error: {
          code: "ITEM_NOT_AVAILABLE_FOR_MINT",
          details: {
            status,
          },
        },
      });
      expect(callRpcRawMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects Mint when item metadata or image is missing", async () => {
    preparePayload = createPreparePayload({
      form: createFormRow({
        image_url: null,
        thumbnail_url: null,
        avatar_url: null,
      }),
      media: [],
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:metadata-missing"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "NFT_METADATA_MISSING",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-mintable collectible before enqueueing", async () => {
    preparePayload = createPreparePayload({
      template: createTemplateRow({
        nft_mintable: false,
      }),
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:not-mintable"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "ITEM_NOT_MINTABLE",
        message: "该藏品不支持 Mint。",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("rejects repeat Mint for an already minted item before enqueueing", async () => {
    preparePayload = createPreparePayload({
      item: createItemRow({
        minted_nft_item_id: QUEUE_ID,
        nft_mint_status: "minted",
      }),
    });

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiErrorResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:already-minted"),
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "ITEM_ALREADY_MINTED",
        message: "藏品已经完成 Mint。",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("enqueues Mint through service-role RPC facades and stores a backend metadata snapshot", async () => {
    const db = {};
    getSupabaseAdminClientMock.mockReturnValue(db);

    const { default: mintHandler } = await import("../../api/wallet/mint");
    const result = await invokeApiHandler<ApiSuccessResponse>(mintHandler, {
      method: "POST",
      url: "/api/wallet/mint",
      headers: requestHeaders("wallet:mint:success"),
      body: {
        item_instance_id: ITEM_ID,
        target_address: ADDRESS,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        accepted: true,
        mintQueueId: QUEUE_ID,
        status: "queued",
        itemInstanceId: ITEM_ID,
        metadataSnapshotGenerated: true,
        metadataUrl: "/nft-metadata/items/ember_whelp.json",
        collection: {
          id: COLLECTION_ID,
          network: "mainnet",
          collectionAddress: COLLECTION_ADDRESS,
        },
      },
    });
    expect(withIdempotencyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "wallet.mint",
        key: "wallet:mint:success",
        userId: USER_ID,
        requestPayload: expect.objectContaining({
          item_instance_id: ITEM_ID,
          target_address: ADDRESS,
        }),
      }),
    );
    const idempotencyInput = withIdempotencyMock.mock.calls[0]?.[0] as
      | { requestPayload?: Record<string, unknown> }
      | undefined;
    expect(idempotencyInput?.requestPayload).not.toHaveProperty(
      "collection_id",
    );
    expect(idempotencyInput?.requestPayload).not.toHaveProperty(
      "collection_address",
    );
    expect(idempotencyInput?.requestPayload).not.toHaveProperty("metadata");
    expect(idempotencyInput?.requestPayload).not.toHaveProperty("priority");
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      1,
      "wallet_prepare_mint_request",
      {
        p_user_id: USER_ID,
        p_item_instance_id: ITEM_ID,
        p_collection_address: null,
        p_network: "mainnet",
      },
      expect.objectContaining({
        schema: "api",
        client: db,
      }),
    );
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      2,
      "wallet_enqueue_mint",
      {
        p_user_id: USER_ID,
        p_item_instance_id: ITEM_ID,
        p_collection_id: COLLECTION_ID,
        p_wallet_id: WALLET_ID,
        p_idempotency_key: "wallet:mint:success",
      },
      expect.objectContaining({
        schema: "api",
        client: db,
      }),
    );
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      3,
      "wallet_save_mint_metadata_snapshot",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_mint_queue_id: QUEUE_ID,
        p_priority: 100,
        p_metadata: expect.objectContaining({
          metadata_url: "/nft-metadata/items/ember_whelp.json",
          collection_address: COLLECTION_ADDRESS,
          metadata_snapshot: expect.objectContaining({
            generated_by: "api.wallet.mint",
            metadata_mode: "DATABASE_SNAPSHOT",
            item_instance: expect.objectContaining({
              id: ITEM_ID,
              serial_no: "10001",
            }),
            metadata: {
              item_metadata_url: "/nft-metadata/items/ember_whelp.json",
              image_url: "/images/ember_whelp.png",
              source: "backend_catalog_snapshot",
            },
          }),
        }),
      }),
      expect.objectContaining({
        schema: "api",
        client: db,
      }),
    );
  });
});

function requestHeaders(idempotencyKey: string): Record<string, string> {
  return {
    cookie: "tma_game_session=test-session-token-000000000000",
    "content-type": "application/json",
    "x-forwarded-for": "127.0.0.71",
    "x-idempotency-key": idempotencyKey,
  };
}

function createPreparePayload(overrides: Record<string, unknown> = {}) {
  return {
    wallet: createWalletRow(),
    other_wallet: createWalletRow(),
    collection: null,
    collections: [createCollectionRow()],
    item: createItemRow(),
    active_lock: null,
    template: createTemplateRow(),
    form: createFormRow(),
    media: [
      createMediaRow("metadata", "/nft-metadata/items/ember_whelp.json"),
      createMediaRow("nft_image", "/images/ember_whelp.png"),
    ],
    ...overrides,
  };
}

function createWalletRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WALLET_ID,
    user_id: USER_ID,
    chain: "TON",
    network: "mainnet",
    address: ADDRESS,
    address_raw: RAW_ADDRESS,
    status: "connected",
    verified_at: "2026-05-29T07:00:00.000Z",
    is_primary: true,
    updated_at: "2026-05-29T07:00:00.000Z",
    ...overrides,
  };
}

function createCollectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COLLECTION_ID,
    code: "MAIN_COLLECTION",
    chain: "TON",
    network: "mainnet",
    collection_address: COLLECTION_ADDRESS,
    owner_address: `EQ${"D".repeat(46)}`,
    standard: "TEP-62",
    metadata_url: "/nft-metadata/collection.json",
    content_base_url: "/nft-metadata/items",
    royalty_config: {},
    status: "active",
    metadata: {},
    created_at: "2026-05-29T06:00:00.000Z",
    updated_at: "2026-05-29T07:00:00.000Z",
    ...overrides,
  };
}

function createItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    owner_user_id: USER_ID,
    template_id: TEMPLATE_ID,
    form_id: FORM_ID,
    serial_no: "10001",
    level: 3,
    exp: 20,
    power: 160,
    status: "available",
    nft_mint_status: "not_minted",
    minted_nft_item_id: null,
    metadata: {},
    created_at: "2026-05-29T06:10:00.000Z",
    updated_at: "2026-05-29T06:10:00.000Z",
    ...overrides,
  };
}

function createTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    slug: "ember_whelp",
    display_name: "Ember Whelp",
    subtitle: "Fire starter",
    description: "A small fire collectible.",
    rarity_code: "RARE",
    type_code: "CHARACTER",
    release_status: "active",
    nft_mintable: true,
    metadata: {},
    ...overrides,
  };
}

function createFormRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    template_id: TEMPLATE_ID,
    form_index: 1,
    form_slug: "base",
    display_name: "Base Form",
    description: "Base form",
    image_url: "/images/ember_whelp.png",
    thumbnail_url: "/images/ember_whelp_thumb.png",
    avatar_url: "/images/ember_whelp_avatar.png",
    is_default: true,
    metadata: {},
    ...overrides,
  };
}

function createMediaRow(mediaType: string, url: string) {
  return {
    id: `${mediaType}-media-id`,
    template_id: TEMPLATE_ID,
    form_id: FORM_ID,
    media_type: mediaType,
    url,
    mime_type: mediaType === "metadata" ? "application/json" : "image/png",
    sort_order: mediaType === "metadata" ? 60 : 50,
    metadata: {},
  };
}
