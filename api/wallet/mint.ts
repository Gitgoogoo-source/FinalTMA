import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  IdempotencyError,
  withIdempotency,
} from "../../packages/server/src/db/idempotency.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import type {
  JsonObject,
  JsonValue,
} from "../../packages/server/src/db/transactions.js";
import { assertMintApiEnabled } from "../../packages/server/src/ton/mintGuards.js";
import {
  CreateMintBodySchema,
  type CreateMintBody,
  type MintQueueStatus,
  type TonChain,
} from "../../packages/validation/src/wallet.schemas.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { assertUserRiskAllowed } from "../_shared/riskGuards.js";
import { validate } from "../_shared/validate.js";

type WalletNetwork = "mainnet" | "testnet";
type MintPriority = "LOW" | "NORMAL" | "HIGH";
type JsonRecord = Record<string, unknown>;

type VerifiedWalletRow = {
  id: string;
  user_id: string;
  chain: string;
  network: string;
  address: string;
  address_raw: string | null;
  status: string;
  verified_at: string | null;
  is_primary: boolean;
  updated_at: string;
};

type NftCollectionRow = {
  id: string;
  code: string;
  chain: string;
  network: string;
  collection_address: string;
  owner_address: string | null;
  standard: string;
  metadata_url: string | null;
  content_base_url: string | null;
  royalty_config: JsonValue;
  status: string;
  metadata: JsonValue;
  created_at: string;
  updated_at: string;
};

type ItemInstanceRow = {
  id: string;
  owner_user_id: string | null;
  template_id: string;
  form_id: string | null;
  serial_no: number | string;
  level: number;
  exp: number;
  power: number;
  status: string;
  nft_mint_status: string;
  minted_nft_item_id: string | null;
  metadata: JsonValue;
  created_at: string;
  updated_at: string;
};

type CollectibleTemplateRow = {
  id: string;
  slug: string;
  display_name: string;
  subtitle: string | null;
  description: string | null;
  rarity_code: string;
  type_code: string;
  release_status: string;
  nft_mintable: boolean;
  metadata: JsonValue;
};

type CollectibleFormRow = {
  id: string;
  template_id: string;
  form_index: number;
  form_slug: string;
  display_name: string;
  description: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  avatar_url: string | null;
  is_default: boolean;
  metadata: JsonValue;
};

type CollectibleMediaRow = {
  id: string;
  template_id: string;
  form_id: string | null;
  media_type: string;
  url: string;
  mime_type: string | null;
  sort_order: number;
  metadata: JsonValue;
};

type InventoryLockRow = {
  id: string;
  lock_type: string;
  source_type: string;
  source_id: string | null;
  status: string;
};

type WalletEnqueueMintRpcResult = {
  mint_queue_id?: unknown;
  status?: unknown;
  item_instance_id?: unknown;
  idempotent?: unknown;
};

type MintMetadataSnapshot = JsonObject;

type PreparedMintRequest = {
  wallet: VerifiedWalletRow;
  collection: NftCollectionRow;
  item: ItemInstanceRow;
  metadataSnapshot: MintMetadataSnapshot;
  metadataUrl: string;
};

type MintPreparationPayload = {
  wallet?: unknown;
  other_wallet?: unknown;
  collection?: unknown;
  collections?: unknown;
  item?: unknown;
  active_lock?: unknown;
  template?: unknown;
  form?: unknown;
  media?: unknown;
};

type MintResponse = {
  accepted: true;
  mintQueueId: string;
  status: MintQueueStatus;
  itemInstanceId: string;
  collection: {
    id: string;
    network: WalletNetwork;
    collectionAddress: string;
    metadataUrl: string;
    contentBaseUrl: string;
  };
  metadataSnapshotGenerated: true;
  metadataUrl: string;
  idempotent: boolean;
};

const SERVER_METADATA_MODE = "DATABASE_SNAPSHOT";

const CLIENT_CONTROLLED_MINT_FIELDS = [
  "collectionId",
  "collection_id",
  "collectionAddress",
  "collection_address",
  "contentBaseUrl",
  "content_base_url",
  "imageUrl",
  "image_url",
  "itemMetadataUrl",
  "item_metadata_url",
  "metadata",
  "metadataJson",
  "metadata_json",
  "metadataMode",
  "metadata_mode",
  "metadataUrl",
  "metadata_url",
  "priority",
] as const;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      CreateMintBodySchema,
      normalizeCreateMintInput(body, getIdempotencyKey(req)),
    );
    const db = getSupabaseAdminClient();

    await assertMintApiEnabled({
      client: db,
    });

    try {
      const result = await withIdempotency<JsonValue>({
        scope: "wallet.mint",
        key: input.idempotencyKey,
        userId: session.userId,
        requestPayload: buildMintRequestPayload(input),
        traceId: ctx.requestId,
        handler: async () => {
          await assertUserRiskAllowed({
            req,
            ctx,
            session,
            action: "wallet.mint",
            idempotencyKey: input.idempotencyKey,
            metadata: {
              itemId: input.itemInstanceId,
            },
          });
          const prepared = await prepareMintRequest(db, input, {
            userId: session.userId,
            requestId: ctx.requestId,
          });
          const rpcResult = await enqueueMintRequest(db, input, prepared, {
            userId: session.userId,
            requestId: ctx.requestId,
          });
          const response = buildMintResponse(rpcResult, prepared);

          await saveMintMetadataSnapshot(db, response.mintQueueId, prepared, {
            requestId: ctx.requestId,
            userId: session.userId,
            metadataMode: SERVER_METADATA_MODE,
            priority: "NORMAL",
          });

          return response as unknown as JsonValue;
        },
      });

      return result.data;
    } catch (error) {
      throw mapMintApiError(error);
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "wallet.mint",
    },
  },
);

export function normalizeCreateMintInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {};
  }

  assertNoClientControlledMintFields(body);

  return compactRecord({
    itemInstanceId:
      readString(body.itemInstanceId) ?? readString(body.item_instance_id),
    targetAddress:
      readString(body.targetAddress) ?? readString(body.target_address),
    chain: normalizeTonChain(body.chain ?? body.network),
    idempotencyKey:
      readString(body.idempotencyKey) ??
      readString(body.idempotency_key) ??
      headerIdempotencyKey,
  });
}

async function prepareMintRequest(
  db: SupabaseAdminClient,
  input: CreateMintBody,
  context: {
    userId: string;
    requestId: string;
  },
): Promise<PreparedMintRequest> {
  const requestedNetwork = networkFromTonChain(input.chain);
  const payload = await loadMintPreparationPayload(db, input, {
    ...context,
    requestedNetwork,
  });
  const wallet = resolveVerifiedWalletFromPayload(payload, requestedNetwork);
  const collection = resolveActiveCollectionFromPayload(
    payload,
    wallet.network,
  );

  assertTargetAddressMatchesWallet(input, wallet);

  const { item, metadataSnapshot, metadataUrl } =
    buildItemMetadataSnapshotFromPayload(payload, {
      requestId: context.requestId,
      wallet,
      collection,
    });

  return {
    wallet,
    collection,
    item,
    metadataSnapshot,
    metadataUrl,
  };
}

async function loadMintPreparationPayload(
  db: SupabaseAdminClient,
  input: CreateMintBody,
  context: {
    userId: string;
    requestId: string;
    requestedNetwork: WalletNetwork;
  },
): Promise<MintPreparationPayload> {
  return await callRpcRaw<MintPreparationPayload>(
    "wallet_prepare_mint_request",
    {
      p_user_id: context.userId,
      p_item_instance_id: input.itemInstanceId,
      p_collection_address: readString(process.env.TON_COLLECTION_ADDRESS),
      p_network: context.requestedNetwork,
    },
    {
      schema: "api" as never,
      client: db,
      context: {
        requestId: context.requestId,
        userId: context.userId,
        itemInstanceId: input.itemInstanceId,
      },
    },
  );
}

function resolveVerifiedWalletFromPayload(
  payload: MintPreparationPayload,
  network: WalletNetwork,
): VerifiedWalletRow {
  const wallet = toNullableRow<VerifiedWalletRow>(payload.wallet);

  if (wallet?.verified_at) {
    return wallet;
  }

  if (wallet) {
    throw new ApiError(
      403,
      "WALLET_NOT_VERIFIED",
      "请先完成钱包签名验证后再 Mint。",
    );
  }

  const otherWallet = toNullableRow<VerifiedWalletRow>(payload.other_wallet);

  if (otherWallet?.verified_at && otherWallet.network !== network) {
    throw new ApiError(
      400,
      "WALLET_NETWORK_MISMATCH",
      "钱包网络与本次 Mint 请求网络不匹配。",
      {
        details: {
          expected: network,
          walletNetwork: otherWallet.network,
        },
      },
    );
  }

  throw new ApiError(
    403,
    "WALLET_NOT_CONNECTED",
    "请先连接钱包后再 Mint。",
  );
}

function resolveActiveCollectionFromPayload(
  payload: MintPreparationPayload,
  walletNetwork: string,
): NftCollectionRow {
  const envCollectionAddress = readString(process.env.TON_COLLECTION_ADDRESS);

  if (envCollectionAddress) {
    const collection = toNullableRow<NftCollectionRow>(payload.collection);

    if (!collection) {
      throw new ApiError(
        503,
        "NFT_COLLECTION_NOT_CONFIGURED",
        "Collection 未配置，暂时无法 Mint。",
        {
          expose: true,
        },
      );
    }

    assertCollectionUsable(collection, walletNetwork);
    return collection;
  }

  const collections = toRowArray<NftCollectionRow>(payload.collections);
  const activeCollection = collections.find(
    (collection) => collection.status === "active",
  );

  if (activeCollection) {
    assertCollectionMetadataConfigured(activeCollection);
    return activeCollection;
  }

  const configuredCollection = collections[0];

  if (configuredCollection) {
    assertCollectionUsable(configuredCollection, walletNetwork);
  }

  throw new ApiError(
    503,
    "NFT_COLLECTION_NOT_CONFIGURED",
    "Collection 未配置，暂时无法 Mint。",
    {
      expose: true,
    },
  );
}

function buildItemMetadataSnapshotFromPayload(
  payload: MintPreparationPayload,
  context: {
    requestId: string;
    wallet: VerifiedWalletRow;
    collection: NftCollectionRow;
  },
): {
  item: ItemInstanceRow;
  metadataSnapshot: MintMetadataSnapshot;
  metadataUrl: string;
} {
  const item = toNullableRow<ItemInstanceRow>(payload.item);

  if (!item) {
    throw new ApiError(404, "ITEM_NOT_FOUND", "藏品不存在或不属于当前用户。");
  }

  assertItemCanEnterMint(item);

  const activeLock = toNullableRow<InventoryLockRow>(payload.active_lock);

  if (activeLock) {
    throw new ApiError(
      409,
      "ITEM_ALREADY_LOCKED",
      "藏品已被其他操作锁定，暂时不能 Mint。",
      {
        details: {
          lockType: activeLock.lock_type,
        },
      },
    );
  }

  const template = toNullableRow<CollectibleTemplateRow>(payload.template);

  if (!template) {
    throw new ApiError(409, "ITEM_NOT_MINTABLE", "藏品模板不存在，不能 Mint。");
  }

  assertTemplateCanMint(template);

  const form = toNullableRow<CollectibleFormRow>(payload.form);
  const mediaRows = toRowArray<CollectibleMediaRow>(payload.media);
  const metadataUrl = resolveItemMetadataUrl(
    context.collection,
    template,
    form,
    mediaRows,
  );
  const imageUrl = resolveImageUrl(form, mediaRows);

  if (!metadataUrl || !imageUrl) {
    throw new ApiError(
      503,
      "NFT_METADATA_MISSING",
      "NFT metadata 或 image 配置缺失。",
      {
        expose: true,
      },
    );
  }

  return {
    item,
    metadataUrl,
    metadataSnapshot: buildMetadataSnapshot({
      requestId: context.requestId,
      wallet: context.wallet,
      collection: context.collection,
      item,
      template,
      form,
      metadataUrl,
      imageUrl,
    }),
  };
}

function assertCollectionUsable(
  collection: NftCollectionRow,
  walletNetwork: string,
): void {
  const envCollectionAddress = readString(process.env.TON_COLLECTION_ADDRESS);

  if (
    envCollectionAddress &&
    collection.collection_address !== envCollectionAddress
  ) {
    throw new ApiError(
      400,
      "COLLECTION_ADDRESS_MISMATCH",
      "请求的 Collection 与服务端配置不一致。",
    );
  }

  if (collection.network !== walletNetwork) {
    throw new ApiError(
      400,
      "COLLECTION_NETWORK_MISMATCH",
      "Collection 网络与用户钱包网络不一致。",
      {
        details: {
          collectionNetwork: collection.network,
          walletNetwork,
        },
      },
    );
  }

  if (collection.status === "paused") {
    throw new ApiError(
      409,
      "NFT_COLLECTION_PAUSED",
      "Collection 已暂停 Mint。",
    );
  }

  if (collection.status !== "active") {
    throw new ApiError(
      409,
      "NFT_COLLECTION_NOT_ACTIVE",
      "Collection 当前不可 Mint。",
      {
        details: {
          status: collection.status,
        },
      },
    );
  }

  assertCollectionMetadataConfigured(collection);
}

function assertCollectionMetadataConfigured(
  collection: NftCollectionRow,
): void {
  if (
    !readString(collection.metadata_url) ||
    !readString(collection.content_base_url)
  ) {
    throw new ApiError(
      503,
      "NFT_COLLECTION_METADATA_MISSING",
      "Collection metadata base URI 未配置。",
      {
        expose: true,
      },
    );
  }
}

function assertItemCanEnterMint(item: ItemInstanceRow): void {
  if (item.status !== "available") {
    throw new ApiError(
      409,
      "ITEM_NOT_AVAILABLE_FOR_MINT",
      "藏品当前状态不能 Mint。",
      {
        details: {
          status: item.status,
        },
      },
    );
  }

  if (item.minted_nft_item_id || item.nft_mint_status === "minted") {
    throw new ApiError(409, "ITEM_ALREADY_MINTED", "藏品已经完成 Mint。");
  }

  if (
    item.nft_mint_status !== "not_minted" &&
    item.nft_mint_status !== "failed"
  ) {
    throw new ApiError(
      409,
      "ITEM_ALREADY_IN_MINT_QUEUE",
      "藏品已有 Mint 请求处理中。",
      {
        details: {
          nftMintStatus: item.nft_mint_status,
        },
      },
    );
  }
}

function assertTemplateCanMint(template: CollectibleTemplateRow): void {
  if (template.release_status !== "active" || !template.nft_mintable) {
    throw new ApiError(409, "ITEM_NOT_MINTABLE", "该藏品不支持 Mint。", {
      details: {
        releaseStatus: template.release_status,
        nftMintable: template.nft_mintable,
      },
    });
  }
}

function resolveItemMetadataUrl(
  collection: NftCollectionRow,
  template: CollectibleTemplateRow,
  form: CollectibleFormRow | null,
  mediaRows: CollectibleMediaRow[],
): string | null {
  const mediaUrl = findPreferredMediaUrl(mediaRows, "metadata", form?.id);

  if (mediaUrl) {
    return mediaUrl;
  }

  const baseUrl = readString(collection.content_base_url);

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/+$/, "")}/${template.slug}.json`;
}

function resolveImageUrl(
  form: CollectibleFormRow | null,
  mediaRows: CollectibleMediaRow[],
): string | null {
  return (
    findPreferredMediaUrl(mediaRows, "nft_image", form?.id) ??
    findPreferredMediaUrl(mediaRows, "card", form?.id) ??
    findPreferredMediaUrl(mediaRows, "hero", form?.id) ??
    findPreferredMediaUrl(mediaRows, "thumb", form?.id) ??
    readString(form?.image_url) ??
    readString(form?.thumbnail_url) ??
    readString(form?.avatar_url)
  );
}

function findPreferredMediaUrl(
  mediaRows: CollectibleMediaRow[],
  mediaType: string,
  formId: string | undefined,
): string | null {
  const exactForm = mediaRows.find(
    (media) =>
      media.media_type === mediaType &&
      media.form_id === formId &&
      readString(media.url),
  );

  if (exactForm) {
    return exactForm.url;
  }

  const templateLevel = mediaRows.find(
    (media) =>
      media.media_type === mediaType &&
      media.form_id === null &&
      readString(media.url),
  );

  if (templateLevel) {
    return templateLevel.url;
  }

  const anyForm = mediaRows.find(
    (media) => media.media_type === mediaType && readString(media.url),
  );

  return anyForm?.url ?? null;
}

function buildMetadataSnapshot(input: {
  requestId: string;
  wallet: VerifiedWalletRow;
  collection: NftCollectionRow;
  item: ItemInstanceRow;
  template: CollectibleTemplateRow;
  form: CollectibleFormRow | null;
  metadataUrl: string;
  imageUrl: string;
}): MintMetadataSnapshot {
  return {
    schema_version: 1,
    generated_by: "api.wallet.mint",
    generated_at: new Date().toISOString(),
    request_id: input.requestId,
    metadata_mode: SERVER_METADATA_MODE,
    item_instance: {
      id: input.item.id,
      serial_no: String(input.item.serial_no),
      level: input.item.level,
      power: input.item.power,
      nft_mint_status: input.item.nft_mint_status,
    },
    collection: {
      id: input.collection.id,
      code: input.collection.code,
      network: input.collection.network,
      collection_address: input.collection.collection_address,
      metadata_url: input.collection.metadata_url,
      content_base_url: input.collection.content_base_url,
      standard: input.collection.standard,
    },
    template: {
      id: input.template.id,
      slug: input.template.slug,
      display_name: input.template.display_name,
      subtitle: input.template.subtitle,
      description: input.template.description,
      rarity_code: input.template.rarity_code,
      type_code: input.template.type_code,
    },
    form: input.form
      ? {
          id: input.form.id,
          form_index: input.form.form_index,
          form_slug: input.form.form_slug,
          display_name: input.form.display_name,
          description: input.form.description,
        }
      : null,
    wallet: {
      wallet_id: input.wallet.id,
      network: input.wallet.network,
      target_address: input.wallet.address,
    },
    metadata: {
      item_metadata_url: input.metadataUrl,
      image_url: input.imageUrl,
      source: "backend_catalog_snapshot",
    },
  };
}

async function enqueueMintRequest(
  db: SupabaseAdminClient,
  input: CreateMintBody,
  prepared: PreparedMintRequest,
  context: {
    userId: string;
    requestId: string;
  },
): Promise<WalletEnqueueMintRpcResult> {
  return await callRpcRaw<WalletEnqueueMintRpcResult>(
    "wallet_enqueue_mint",
    {
      p_user_id: context.userId,
      p_item_instance_id: input.itemInstanceId,
      p_collection_id: prepared.collection.id,
      p_wallet_id: prepared.wallet.id,
      p_idempotency_key: input.idempotencyKey,
    },
    {
      schema: "api" as never,
      client: db,
      context: {
        requestId: context.requestId,
        userId: context.userId,
        itemInstanceId: input.itemInstanceId,
        collectionId: prepared.collection.id,
      },
    },
  );
}

async function saveMintMetadataSnapshot(
  db: SupabaseAdminClient,
  mintQueueId: string,
  prepared: PreparedMintRequest,
  context: {
    requestId: string;
    userId: string;
    metadataMode: typeof SERVER_METADATA_MODE;
    priority: MintPriority;
  },
): Promise<void> {
  try {
    await callRpcRaw(
      "wallet_save_mint_metadata_snapshot",
      {
        p_user_id: context.userId,
        p_mint_queue_id: mintQueueId,
        p_priority: toQueuePriority(context.priority),
        p_metadata: {
          request_id: context.requestId,
          metadata_mode: context.metadataMode,
          metadata_snapshot: prepared.metadataSnapshot,
          metadata_url: prepared.metadataUrl,
          collection_address: prepared.collection.collection_address,
        },
      },
      {
        schema: "api" as never,
        client: db,
        context: {
          requestId: context.requestId,
          userId: context.userId,
          mintQueueId,
        },
      },
    );
  } catch (error) {
    throw new ApiError(
      500,
      "MINT_METADATA_SNAPSHOT_SAVE_FAILED",
      "保存 Mint metadata snapshot 失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

function buildMintResponse(
  rpcResult: WalletEnqueueMintRpcResult,
  prepared: PreparedMintRequest,
): MintResponse {
  const mintQueueId = readString(rpcResult.mint_queue_id);

  if (!mintQueueId) {
    throw new ApiError(
      500,
      "MINT_QUEUE_RESPONSE_INVALID",
      "Mint 队列响应缺少队列 ID。",
      {
        expose: false,
      },
    );
  }

  return {
    accepted: true,
    mintQueueId,
    status: normalizeMintQueueStatus(rpcResult.status),
    itemInstanceId: readString(rpcResult.item_instance_id) ?? prepared.item.id,
    collection: {
      id: prepared.collection.id,
      network: prepared.collection.network as WalletNetwork,
      collectionAddress: prepared.collection.collection_address,
      metadataUrl: prepared.collection.metadata_url ?? "",
      contentBaseUrl: prepared.collection.content_base_url ?? "",
    },
    metadataSnapshotGenerated: true,
    metadataUrl: prepared.metadataUrl,
    idempotent: Boolean(rpcResult.idempotent),
  };
}

function assertTargetAddressMatchesWallet(
  input: CreateMintBody,
  wallet: VerifiedWalletRow,
): void {
  if (!input.targetAddress) {
    return;
  }

  const allowedAddresses = new Set(
    [wallet.address, wallet.address_raw].filter(Boolean),
  );

  if (!allowedAddresses.has(input.targetAddress)) {
    throw new ApiError(
      400,
      "MINT_TARGET_WALLET_MISMATCH",
      "Mint 目标地址必须是当前已验证钱包。",
    );
  }
}

function buildMintRequestPayload(input: CreateMintBody): JsonObject {
  return compactJsonRecord({
    item_instance_id: input.itemInstanceId,
    target_address: input.targetAddress,
    chain: input.chain,
  });
}

function assertNoClientControlledMintFields(body: JsonRecord): void {
  const blockedFields = CLIENT_CONTROLLED_MINT_FIELDS.filter(
    (field) => field in body,
  );

  if (blockedFields.length === 0) {
    return;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
    details: blockedFields.map((field) => ({
      path: field,
      message: "Mint Collection、metadata 和队列优先级只能由服务端配置或生成。",
      code: "CLIENT_CONTROLLED_MINT_FIELD",
    })),
  });
}

function mapMintApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof IdempotencyError) {
    return new ApiError(
      error.status,
      error.code,
      mapIdempotencyMessage(error.code),
      {
        details: error.details,
        expose: error.status < 500,
        cause: error,
      },
    );
  }

  if (error instanceof RpcError) {
    return mapMintRpcError(error);
  }

  return new ApiError(500, "MINT_REQUEST_FAILED", "创建 Mint 请求失败。", {
    expose: false,
    cause: error,
  });
}

function mapMintRpcError(error: RpcError): ApiError {
  const message = error.message.toLowerCase();

  if (message.includes("idempotency conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他 Mint 请求使用。",
      {
        cause: error,
      },
    );
  }

  if (message.includes("active nft collection not found")) {
    return new ApiError(
      503,
      "NFT_COLLECTION_NOT_CONFIGURED",
      "Collection 未配置，暂时无法 Mint。",
      {
        expose: true,
        cause: error,
      },
    );
  }

  if (
    message.includes("wallet not found") ||
    message.includes("wallet does not belong to user") ||
    message.includes("wallet is not verified")
  ) {
    return new ApiError(
      403,
      "WALLET_NOT_VERIFIED",
      "请先完成钱包签名验证后再 Mint。",
      {
        cause: error,
      },
    );
  }

  if (message.includes("wallet network does not match nft collection")) {
    return new ApiError(
      400,
      "WALLET_NETWORK_MISMATCH",
      "钱包网络与本次 Mint 请求网络不匹配。",
      {
        cause: error,
      },
    );
  }

  if (
    message.includes("not item owner") ||
    message.includes("item not found")
  ) {
    return new ApiError(404, "ITEM_NOT_FOUND", "藏品不存在或不属于当前用户。", {
      cause: error,
    });
  }

  if (message.includes("item is not available for mint")) {
    return new ApiError(
      409,
      "ITEM_NOT_AVAILABLE_FOR_MINT",
      "藏品当前状态不能 Mint。",
      {
        cause: error,
      },
    );
  }

  if (message.includes("item has active inventory lock")) {
    return new ApiError(
      409,
      "ITEM_ALREADY_LOCKED",
      "藏品已被其他操作锁定，暂时不能 Mint。",
      {
        cause: error,
      },
    );
  }

  if (message.includes("item is not mintable")) {
    return new ApiError(409, "ITEM_NOT_MINTABLE", "该藏品不支持 Mint。", {
      cause: error,
    });
  }

  return new ApiError(500, "MINT_QUEUE_RPC_FAILED", "创建 Mint 队列失败。", {
    expose: false,
    cause: error,
  });
}

function mapIdempotencyMessage(code: string): string {
  switch (code) {
    case "IDEMPOTENCY_KEY_REQUIRED":
      return "缺少幂等键。";
    case "IDEMPOTENCY_REQUEST_MISMATCH":
      return "幂等键已被其他 Mint 请求使用。";
    case "IDEMPOTENCY_IN_PROGRESS":
      return "Mint 请求正在处理中，请稍后重试。";
    case "IDEMPOTENCY_PREVIOUSLY_FAILED":
      return "相同 Mint 请求此前失败，请重新发起。";
    default:
      return "Mint 请求幂等校验失败。";
  }
}

function normalizeMintQueueStatus(value: unknown): MintQueueStatus {
  const status = readString(value);

  switch (status) {
    case "queued":
    case "processing":
    case "submitted":
    case "confirming":
    case "retrying":
    case "manual_review":
    case "minted":
    case "failed":
    case "cancelled":
      return status;
    default:
      return "queued";
  }
}

function normalizeTonChain(value: unknown): TonChain | undefined {
  const text = readString(value)?.toLowerCase();

  switch (text) {
    case "mainnet":
    case "main":
    case "-239":
      return "MAINNET";
    case "testnet":
    case "test":
    case "-3":
      return "TESTNET";
    default:
      return undefined;
  }
}

function networkFromTonChain(chain: TonChain): WalletNetwork {
  return chain === "TESTNET" ? "testnet" : "mainnet";
}

function toQueuePriority(priority: MintPriority): number {
  switch (priority) {
    case "HIGH":
      return 50;
    case "LOW":
      return 200;
    case "NORMAL":
    default:
      return 100;
  }
}

function compactRecord(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null,
    ),
  );
}

function compactJsonRecord(
  value: Record<string, JsonValue | undefined>,
): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as JsonObject;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableRow<T>(value: unknown): T | null {
  if (!isRecord(value) || !readString(value.id)) {
    return null;
  }

  return value as T;
}

function toRowArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord) as T[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
