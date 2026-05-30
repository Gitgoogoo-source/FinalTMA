import { parseJsonBody } from "../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import {
  assertAdminPermissions,
  requireAdmin,
} from "../_shared/requireAdmin.js";
import type { JsonValue } from "../../packages/server/src/db/transactions.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  isRecord,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
  toJsonObject,
} from "./_shared.js";

type DangerAction =
  | "compensate_asset"
  | "ban_user"
  | "request_refund"
  | "release_inventory_lock"
  | "publish_drop_pool_version";

type DangerRpcResult = Record<string, unknown> & {
  server_time?: string;
};
type AdminWriteRpcCall = {
  functionName: string;
  requestId: string;
  args: Record<string, JsonValue | undefined>;
};

const ACTION_PERMISSIONS: Record<DangerAction, string[]> = {
  compensate_asset: ["risk:write"],
  ban_user: ["users:ban", "risk:write"],
  request_refund: ["payments:write"],
  release_inventory_lock: ["inventory:write", "risk:write"],
  publish_drop_pool_version: ["gacha:write"],
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req);
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 256 * 1024 }),
    );
    const action = normalizeDangerAction(body.action);

    assertAdminPermissions(admin, {
      permissions: ACTION_PERMISSIONS[action],
      requireAll: false,
    });
    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const reason = normalizeRequiredText(body.reason, "reason");
    const approvalContext = normalizeJsonRecord(body.approvalContext);
    const requestContext = buildAdminRpcContext(admin, ctx);
    const rpcCall = buildDangerRpcCall({
      action,
      adminUserId: admin.adminId,
      body,
      idempotencyKey,
      reason,
      requestContext,
      approvalContext,
      requestId: ctx.requestId,
    });

    try {
      const result = await callAdminWriteRpc<DangerRpcResult>(rpcCall);

      return {
        ...result,
        action,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, `ADMIN_${action.toUpperCase()}_FAILED`);
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function normalizeDangerAction(value: unknown): DangerAction {
  const action = normalizeRequiredText(value, "action")
    .replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
    .replace(/[-\s]+/g, "_")
    .toLowerCase();

  if (
    action === "compensate_asset" ||
    action === "ban_user" ||
    action === "request_refund" ||
    action === "release_inventory_lock" ||
    action === "publish_drop_pool_version"
  ) {
    return action;
  }

  throw new ApiError(
    400,
    "VALIDATION_FAILED",
    `Unsupported admin danger action: ${action}`,
  );
}

function buildDangerRpcCall(input: {
  action: DangerAction;
  adminUserId: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  reason: string;
  requestContext: ReturnType<typeof buildAdminRpcContext>;
  approvalContext: ReturnType<typeof toJsonObject>;
  requestId: string;
}): AdminWriteRpcCall {
  const commonArgs = {
    p_admin_user_id: input.adminUserId,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_request_context: input.requestContext,
    p_approval_context: input.approvalContext,
  };

  switch (input.action) {
    case "compensate_asset":
      return {
        functionName: "admin_compensate_asset",
        requestId: input.requestId,
        args: {
          ...commonArgs,
          p_user_id: normalizeRequiredUuid(input.body.userId, "userId"),
          p_currency_code: normalizeRequiredText(
            input.body.currencyCode,
            "currencyCode",
          ),
          p_amount: normalizePositiveNumber(input.body.amount, "amount"),
          p_metadata: normalizeJsonRecord(input.body.metadata),
        },
      };
    case "ban_user":
      return {
        functionName: "admin_ban_user",
        requestId: input.requestId,
        args: {
          ...commonArgs,
          p_user_id: normalizeRequiredUuid(input.body.userId, "userId"),
          p_status: normalizeOptionalText(input.body.status) ?? "banned",
        },
      };
    case "request_refund":
      return {
        functionName: "admin_request_star_refund",
        requestId: input.requestId,
        args: {
          ...commonArgs,
          p_star_order_id: normalizeRequiredUuid(
            input.body.starOrderId ?? input.body.orderId,
            "starOrderId",
          ),
        },
      };
    case "release_inventory_lock":
      return {
        functionName: "admin_release_inventory_lock",
        requestId: input.requestId,
        args: {
          ...commonArgs,
          p_lock_id: normalizeRequiredUuid(input.body.lockId, "lockId"),
        },
      };
    case "publish_drop_pool_version":
      return {
        functionName: "admin_publish_drop_pool_version",
        requestId: input.requestId,
        args: {
          ...commonArgs,
          p_drop_pool_version_id: normalizeRequiredUuid(
            input.body.dropPoolVersionId ??
              input.body.drop_pool_version_id ??
              input.body.poolVersionId,
            "dropPoolVersionId",
          ),
        },
      };
  }
}

function normalizeJsonRecord(value: unknown): ReturnType<typeof toJsonObject> {
  return toJsonObject(isRecord(value) ? value : {});
}

function normalizePositiveNumber(value: unknown, field: string): number {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a positive number`,
    );
  }

  return amount;
}
