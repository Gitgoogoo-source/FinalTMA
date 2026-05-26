import {
  BindReferralBodySchema,
  type BindReferralBody,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError } from "../_shared/handler.js";
import {
  assertNoClientControlledTaskFields,
  assertNoSensitiveMetadata,
  assertTaskRecordPayload,
  callTaskRpcRaw,
  compactRecord,
  isRecord,
  mapTaskRpcError,
  parseTaskJsonBodyInput,
  readBoolean,
  readIsoDateString,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = await parseTaskJsonBodyInput(req, BindReferralBodySchema, {
      maxBytes: 8 * 1024,
      normalize: normalizeBindReferralInput,
    });
    const payload = await callBindReferralRpc(
      input,
      ctx.session,
      ctx.requestId,
    );

    return normalizeBindReferralPayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.bind_referral",
    },
  },
);

export function normalizeBindReferralInput(
  body: unknown,
  idempotencyKey: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotencyKey,
    };
  }

  assertNoClientControlledTaskFields(
    body,
    "绑定邀请请求不能携带用户身份字段。",
  );
  assertNoSensitiveMetadata(body.metadata);

  return {
    inviteCode: extractInviteCode(
      body.inviteCode ??
        body.invite_code ??
        body.referralCode ??
        body.referral_code ??
        body.startPayload ??
        body.start_payload ??
        body.startParam ??
        body.start_param,
    ),
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    idempotencyKey,
  };
}

async function callBindReferralRpc(
  input: BindReferralBody,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskRpcRaw(
      "referral_bind_inviter",
      {
        p_invitee_user_id: session.userId,
        p_invite_code: input.inviteCode,
        p_idempotency_key: input.idempotencyKey,
        p_metadata: input.metadata ?? {},
      },
      {
        requestId,
        userId: session.userId,
        idempotencyKey: input.idempotencyKey,
        inviteCode: input.inviteCode,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "REFERRAL_BIND_RPC_FAILED",
      "绑定邀请关系失败，请稍后重试。",
    );
  }
}

export function normalizeBindReferralPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "REFERRAL_BIND_RESULT_INVALID",
    "绑定邀请结果格式无效。",
  );
  const bound = readBoolean(result.bound) ?? false;
  const status = readString(result.status) ?? (bound ? "pending" : "rejected");
  const reason = readString(result.reason);

  if (!bound) {
    throw mapBindReferralRejectedPayload(status, reason);
  }

  return compactRecord({
    bound,
    status,
    reason,
    referral_id: readString(result.referral_id),
    invite_code: readString(result.invite_code),
    created_at: readIsoDateString(result.created_at),
    idempotent: readBoolean(result.idempotent) ?? false,
  });
}

function mapBindReferralRejectedPayload(
  status: string,
  reason: string | null,
): ApiError {
  if (reason === "self_invite_not_allowed") {
    return new ApiError(
      400,
      "REFERRAL_SELF_INVITE_NOT_ALLOWED",
      "不能邀请自己。",
      {
        details: { status, reason },
      },
    );
  }

  if (reason === "referral_already_bound" || status === "conflict") {
    return new ApiError(409, "REFERRAL_ALREADY_BOUND", "邀请关系已绑定。", {
      details: { status, reason },
    });
  }

  if (reason === "invite_code_not_found") {
    return new ApiError(404, "REFERRAL_INVITER_NOT_FOUND", "邀请人不存在。", {
      details: { status, reason },
    });
  }

  return new ApiError(
    500,
    "REFERRAL_BIND_RESULT_INVALID",
    "绑定邀请结果格式无效。",
    {
      details: { status, reason },
      expose: false,
    },
  );
}

function extractInviteCode(value: unknown): unknown {
  const text = readString(value);
  if (!text) {
    return value;
  }

  const normalized = text.replace(/^(ref_|invite_)/i, "");
  return normalized.toUpperCase();
}
