import { parseJsonBody } from "../_shared/parseBody.js";
import { withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "./_shared.js";

type RetryMintRpcResult = {
  mint_queue_id: string;
  status: string;
  previous_status?: string;
  idempotent?: boolean;
  audit_log_id?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["mint:write", "onchain:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const mintQueueId = normalizeRequiredUuid(body.mintQueueId, "mintQueueId");
    const reason = normalizeRequiredText(body.reason, "reason");
    const priority = normalizeOptionalText(body.priority) ?? "HIGH";

    try {
      const result = await callAdminWriteRpc<RetryMintRpcResult>({
        functionName: "admin_retry_mint_queue",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_mint_queue_id: mintQueueId,
          p_priority: priority,
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
      throw mapAdminRpcError(error, "ADMIN_RETRY_MINT_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
