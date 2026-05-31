import { loadPaymentSupportConfig } from "../_shared/paymentSupportConfig.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "./_shared.js";

type PaymentSupportMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    if (ctx.method === "GET") {
      await requireAdmin(req, {
        permissions: ["payments:read", "admin:read"],
        requireAll: false,
      });

      const config = await loadPaymentSupportConfig();

      return {
        ...config,
        serverTime: new Date().toISOString(),
      };
    }

    const admin = await requireAdmin(req, {
      permissions: ["payments:write", "admin:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 16 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const reason = normalizeRequiredText(body.reason, "reason");
    const supportUrl = normalizeNullableSupportUrl(
      body.supportUrl ?? body.support_url,
    );
    const supportEmail = normalizeNullableSupportEmail(
      body.supportEmail ?? body.support_email,
    );

    try {
      const result = await callAdminWriteRpc<PaymentSupportMutationResult>({
        functionName: "admin_update_payment_support_config",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_support_url: supportUrl,
          p_support_email: supportEmail,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      return {
        ...mapPaymentSupportMutationResult(result),
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(
        error,
        "ADMIN_PAYMENT_SUPPORT_CONFIG_UPDATE_FAILED",
      );
    }
  },
  {
    methods: ["GET", "PATCH"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function normalizeNullableSupportUrl(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "supportUrl must be a valid HTTPS URL",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new ApiError(400, "VALIDATION_FAILED", "supportUrl must use HTTPS");
  }

  return parsed.toString();
}

function normalizeNullableSupportEmail(value: unknown): string | null {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;

  if (!normalized) {
    return null;
  }

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "supportEmail must be a valid email address",
    );
  }

  return normalized;
}

function mapPaymentSupportMutationResult(result: PaymentSupportMutationResult) {
  return {
    audit_log_id: result.audit_log_id ?? null,
    configured: result.configured === true,
    supportEmail:
      typeof result.support_email === "string" ? result.support_email : null,
    supportUrl:
      typeof result.support_url === "string" ? result.support_url : null,
    updatedAt: typeof result.updated_at === "string" ? result.updated_at : null,
    source: "system_settings" as const,
    idempotent: result.idempotent === true,
  };
}
