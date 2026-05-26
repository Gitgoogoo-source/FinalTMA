import {
  ShareEventBodySchema,
  type ShareEventBody,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError } from "../_shared/handler.js";
import {
  assertNoClientControlledTaskFields,
  assertNoSensitiveMetadata,
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  compactRecord,
  isRecord,
  mapTaskRpcError,
  parseTaskJsonBodyInput,
  readBoolean,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

type ShareEventInput = ShareEventBody & {
  idempotencyKey: string;
};

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const parsed = await parseTaskJsonBodyInput(req, ShareEventBodySchema, {
      maxBytes: 16 * 1024,
      normalize: normalizeShareEventInput,
    });
    const input = requireShareEventIdempotency(parsed);
    const payload = await callShareEventRpc(input, ctx.session, ctx.requestId);

    return normalizeShareEventPayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.share_event",
    },
  },
);

export function normalizeShareEventInput(
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
    "分享事件请求不能携带用户身份字段。",
  );
  assertNoRawChatId(body);
  assertNoSensitiveMetadata(body.metadata);

  return {
    scene: body.scene,
    referralCode: body.referralCode ?? body.referral_code,
    campaignId: body.campaignId ?? body.campaign_id,
    targetChatType: body.targetChatType ?? body.target_chat_type,
    targetChatIdHash: body.targetChatIdHash ?? body.target_chat_id_hash,
    messageId: body.messageId ?? body.message_id,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    idempotencyKey,
  };
}

async function callShareEventRpc(
  input: ShareEventInput,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  const shareType = resolveShareType(input);

  try {
    return await callTaskUserRpcRaw(
      "referral_record_share_event",
      session,
      {
        p_share_type: shareType,
        p_payload: buildSharePayload(input, shareType),
        p_idempotency_key: input.idempotencyKey,
      },
      {
        requestId,
        idempotencyKey: input.idempotencyKey,
        shareType,
        scene: input.scene,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "REFERRAL_SHARE_EVENT_RPC_FAILED",
      "记录分享事件失败，请稍后重试。",
    );
  }
}

export function normalizeShareEventPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "REFERRAL_SHARE_EVENT_RESULT_INVALID",
    "分享事件结果格式无效。",
  );
  const eventId = readString(result.event_id);

  return compactRecord({
    accepted: readBoolean(result.processed) ?? Boolean(eventId),
    event_id: eventId,
    share_type: readString(result.share_type),
    progress: result.progress,
    idempotent: readBoolean(result.idempotent) ?? false,
  });
}

function requireShareEventIdempotency(input: ShareEventBody): ShareEventInput {
  if (!input.idempotencyKey) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  return {
    ...input,
    idempotencyKey: input.idempotencyKey,
  };
}

function resolveShareType(input: ShareEventBody): string {
  switch (input.targetChatType) {
    case "USER":
      return "telegram_user";
    case "GROUP":
    case "SUPERGROUP":
      return "telegram_group";
    case "CHANNEL":
      return "telegram_channel";
    default:
      return input.scene === "COLLECTION_DETAIL" ? "card_share" : "copy_link";
  }
}

function buildSharePayload(
  input: ShareEventBody,
  shareType: string,
): Record<string, unknown> {
  return compactRecord({
    scene: input.scene,
    referral_code: input.referralCode,
    campaign_id: input.campaignId,
    target_chat_type: input.targetChatType,
    target_chat_id_hash: input.targetChatIdHash,
    message_id: input.messageId,
    target: shareType.startsWith("telegram_") ? "telegram" : "task_page",
    metadata: input.metadata,
  });
}

function assertNoRawChatId(body: Record<string, unknown>): void {
  const forbiddenFields = ["targetChatId", "target_chat_id"].filter(
    (field) => body[field] !== undefined,
  );

  if (forbiddenFields.length === 0) {
    return;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
    details: forbiddenFields.map((field) => ({
      path: field,
      message: "分享事件只能携带脱敏后的 chat id hash。",
    })),
  });
}
