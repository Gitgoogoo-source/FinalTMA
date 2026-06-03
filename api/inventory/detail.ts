import { InventoryDetailQuerySchema } from "../../packages/validation/src/inventory.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { normalizePublicStorageUrl } from "../_shared/publicStorageUrl.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import {
  assertRecordPayload,
  getErrorMessage,
  getRpcErrorText,
  invalidInventoryResult,
  isRecord,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from "./_shared.js";

type InventoryDetailRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(InventoryDetailQuerySchema, req.query);

    const payload = await callInventoryDetailRpc(
      session.userId,
      query,
      ctx.requestId,
    );

    return normalizeInventoryDetailPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "inventory.detail",
    },
  },
);

async function callInventoryDetailRpc(
  userId: string,
  query: {
    item_instance_id: string;
    include_market_status: boolean;
    include_upgrade_preview: boolean;
    include_evolution_preview: boolean;
    include_decompose_preview: boolean;
    include_onchain_status: boolean;
  },
  requestId: string,
): Promise<InventoryDetailRpcPayload> {
  try {
    return await callRpcRaw<InventoryDetailRpcPayload>(
      "inventory_get_item_detail",
      {
        p_user_id: userId,
        p_item_instance_id: query.item_instance_id,
        p_include_market_status: query.include_market_status,
        p_include_upgrade_preview: query.include_upgrade_preview,
        p_include_evolution_preview: query.include_evolution_preview,
        p_include_decompose_preview: query.include_decompose_preview,
        p_include_onchain_status: query.include_onchain_status,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          itemInstanceId: query.item_instance_id,
        },
      },
    );
  } catch (error) {
    throw mapInventoryDetailRpcError(error);
  }
}

export function normalizeInventoryDetailPayload(payload: unknown) {
  const item = assertRecordPayload(
    payload,
    "INVENTORY_DETAIL_RESULT_INVALID",
    "藏品详情结果格式无效。",
  );
  const itemInstanceId = readString(item.item_instance_id);
  const templateId = readString(item.template_id);

  if (!itemInstanceId || !templateId) {
    throw invalidInventoryResult(
      "INVENTORY_DETAIL_RESULT_INVALID",
      "藏品详情结果缺少必要字段。",
      {
        item_instance_id: item.item_instance_id,
        template_id: item.template_id,
      },
    );
  }

  return {
    item_instance_id: itemInstanceId,
    template_id: templateId,
    template_slug: readString(item.template_slug),
    form_id: readString(item.form_id),
    serial_no: readNumber(item.serial_no),
    name: readString(item.name) ?? "Unknown item",
    subtitle: readString(item.subtitle),
    description: readString(item.description),
    rarity: normalizeNamedObject(item.rarity),
    type_code: readString(item.type_code),
    series: normalizeNamedObject(item.series),
    faction: normalizeNamedObject(item.faction),
    form: normalizeForm(item.form),
    level: readNumber(item.level) ?? 1,
    power: readNumber(item.power) ?? 0,
    base_power: readNumber(item.base_power),
    status: readString(item.status),
    nft_mint_status: readString(item.nft_mint_status),
    image_url: normalizePublicStorageUrl(item.image_url),
    thumbnail_url: normalizePublicStorageUrl(item.thumbnail_url),
    avatar_url: normalizePublicStorageUrl(item.avatar_url),
    is_tradeable:
      readBoolean(item.is_tradeable) ?? readBoolean(item.tradeable) ?? false,
    is_upgradeable:
      readBoolean(item.is_upgradeable) ??
      readBoolean(item.upgradeable) ??
      false,
    is_evolvable:
      readBoolean(item.is_evolvable) ?? readBoolean(item.evolvable) ?? false,
    is_decomposable:
      readBoolean(item.is_decomposable) ??
      readBoolean(item.decomposable) ??
      false,
    is_mintable:
      readBoolean(item.is_mintable) ?? readBoolean(item.nft_mintable) ?? false,
    source_type: readString(item.source_type),
    source_id: readString(item.source_id),
    obtained_at: readString(item.obtained_at),
    updated_at: readString(item.updated_at),
    attributes: isRecord(item.attributes) ? item.attributes : {},
    active_lock: normalizeActiveLock(item.active_lock),
    market_status: normalizeMarketStatus(item.market_status),
    onchain_status: normalizeOnchainStatus(item.onchain_status),
    upgrade_preview: normalizeUpgradePreview(item.upgrade_preview),
    evolution_preview: normalizeEvolutionPreview(item.evolution_preview),
    decompose_preview: normalizeDecomposePreview(item.decompose_preview),
    same_item_count: readNumber(item.same_item_count) ?? 0,
    available_same_item_count: readNumber(item.available_same_item_count) ?? 0,
  };
}

function normalizeNamedObject(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    id: readString(value.id),
    code: readString(value.code),
    slug: readString(value.slug),
    display_name: readString(value.display_name),
    sort_order: readNumber(value.sort_order),
  };
}

function normalizeForm(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    id: readString(value.id),
    index: readNumber(value.index),
    display_name: readString(value.display_name),
    description: readString(value.description),
  };
}

function normalizeActiveLock(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    lock_id: readString(value.lock_id),
    reason: readString(value.reason),
    source_type: readString(value.source_type),
    source_id: readString(value.source_id),
    locked_at: readString(value.locked_at),
    expires_at: readString(value.expires_at),
  };
}

function normalizeMarketStatus(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    is_listed: readBoolean(value.is_listed) ?? false,
    listing_id: readString(value.listing_id),
    unit_price: readNumber(value.unit_price),
    currency: readString(value.currency),
  };
}

function normalizeOnchainStatus(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    is_minted: readBoolean(value.is_minted) ?? false,
    mint_status: readString(value.mint_status) ?? "none",
  };
}

function normalizeUpgradePreview(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    can_upgrade: readBoolean(value.can_upgrade) ?? false,
    reason: readString(value.reason),
    current_level: readNumber(value.current_level),
    next_level: readNumber(value.next_level),
    target_level: readNumber(value.target_level),
    current_power: readNumber(value.current_power),
    power_after: readNumber(value.power_after),
    fgems_cost: readNumber(value.fgems_cost) ?? readNumber(value.cost_fgems),
    user_fgems_balance: readNumber(value.user_fgems_balance),
    is_balance_enough: readBoolean(value.is_balance_enough),
  };
}

function normalizeEvolutionPreview(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    can_evolve: readBoolean(value.can_evolve) ?? false,
    reason: readString(value.reason),
    required_count:
      readNumber(value.required_count) ??
      readNumber(value.required_same_items) ??
      3,
    available_same_items: readNumber(value.available_same_items),
    kcoin_cost: readNumber(value.kcoin_cost) ?? readNumber(value.cost_kcoin),
    user_kcoin_balance: readNumber(value.user_kcoin_balance),
    is_balance_enough: readBoolean(value.is_balance_enough),
    success_rate_bps: readNumber(value.success_rate_bps),
    target_template_id: readString(value.target_template_id),
    target_form_id: readString(value.target_form_id),
    target_name: readString(value.target_name),
    target_image_url: normalizePublicStorageUrl(value.target_image_url),
    selected_item_ids: readStringArray(value.selected_item_ids),
    main_return_item_id: readString(value.main_return_item_id),
  };
}

function normalizeDecomposePreview(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    can_decompose: readBoolean(value.can_decompose) ?? false,
    reason: readString(value.reason),
    fgems_reward:
      readNumber(value.fgems_reward) ??
      readNumber(value.reward_fgems) ??
      readNumber(value.total_reward_fgems),
    total_reward_fgems: readNumber(value.total_reward_fgems),
    duplicate_count: readNumber(value.duplicate_count),
    item_status: readString(value.item_status),
    item_instance_ids: readStringArray(value.item_instance_ids),
    items: Array.isArray(value.items) ? value.items : [],
  };
}

function mapInventoryDetailRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询藏品详情失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("item not found")) {
    return new ApiError(404, "ITEM_NOT_FOUND", "藏品不存在。");
  }

  if (message.includes("not item owner")) {
    return new ApiError(403, "ITEM_NOT_OWNER", "不能查看不属于你的藏品。");
  }

  if (message.includes("user_id and item_instance_id are required")) {
    return ApiError.badRequest("缺少藏品参数。");
  }

  return new ApiError(
    500,
    "INVENTORY_DETAIL_RPC_FAILED",
    "查询藏品详情失败。",
    {
      cause: error,
      expose: false,
    },
  );
}
