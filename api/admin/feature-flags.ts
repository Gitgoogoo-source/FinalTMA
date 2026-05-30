import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import {
  assertAdminPermissions,
  requireAdmin,
} from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  firstQueryValue,
  mapAdminRpcError,
  normalizeBoolean,
  normalizeOptionalText,
  normalizeRequiredText,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "./_shared.js";

type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  description: string | null;
  rollout: unknown;
  updated_by_admin_id: string | null;
  updated_at: string;
  created_at: string;
};

type UpdateFeatureFlagRpcResult = {
  key: string;
  enabled: boolean;
  previous_enabled?: boolean | null;
  idempotent?: boolean;
  audit_log_id?: string;
};

const FEATURE_FLAG_COLUMNS = [
  "key",
  "enabled",
  "description",
  "rollout",
  "updated_by_admin_id",
  "updated_at",
  "created_at",
].join(",");

export default withApiHandler(
  async (req, _res, ctx) => {
    if (ctx.method === "GET") {
      await requireAdmin(req, {
        permissions: ["feature_flags:read", "admin:read"],
        requireAll: false,
      });

      return await listFeatureFlags(getSupabaseAdminClient(), req.query);
    }

    const admin = await requireAdmin(req);
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const key = normalizeRequiredText(body.key, "key");
    const enabled = normalizeBoolean(body.enabled, "enabled");
    const reason = normalizeRequiredText(body.reason, "reason");
    const description = normalizeOptionalText(body.description);

    assertAdminPermissions(admin, {
      permissions: getFeatureFlagWritePermissions(key),
      requireAll: false,
    });

    try {
      const result = await callAdminWriteRpc<UpdateFeatureFlagRpcResult>({
        functionName: "admin_update_feature_flag",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_key: key,
          p_enabled: enabled,
          p_description: description,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      return {
        ...result,
        serverTime: new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_FEATURE_FLAG_UPDATE_FAILED");
    }
  },
  {
    methods: ["GET", "PATCH"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function getFeatureFlagWritePermissions(key: string): string[] {
  const normalized = key.trim();

  if (
    [
      "FEATURE_STARS_PAYMENT_ENABLED",
      "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
    ].includes(normalized)
  ) {
    return ["payments:write", "feature_flags:write", "admin:write"];
  }

  if (normalized === "gacha.open_box") {
    return ["gacha:write", "feature_flags:write", "admin:write"];
  }

  if (["FEATURE_MARKET_ENABLED", "market.enabled"].includes(normalized)) {
    return ["market:write", "feature_flags:write", "admin:write"];
  }

  if (
    [
      "FEATURE_TON_MINT_ENABLED",
      "FEATURE_MINT_WORKER_ENABLED",
      "onchain.mint",
    ].includes(normalized)
  ) {
    return [
      "inventory:write",
      "mint:write",
      "onchain:write",
      "feature_flags:write",
      "admin:write",
    ];
  }

  return ["feature_flags:write", "admin:write"];
}

async function listFeatureFlags(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
): Promise<{
  items: FeatureFlagRow[];
  serverTime: string;
}> {
  let query = db
    .schema("ops")
    .from("feature_flags")
    .select(FEATURE_FLAG_COLUMNS);
  const q = firstQueryValue(queryInput.q);

  if (q) {
    query = query.ilike("key", `%${q}%`);
  }

  const { data, error } = await query.order("key", { ascending: true });

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_FEATURE_FLAGS_LOOKUP_FAILED",
      "功能开关查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return {
    items: Array.isArray(data) ? (data as unknown as FeatureFlagRow[]) : [],
    serverTime: new Date().toISOString(),
  };
}
