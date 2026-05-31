import {
  ClaimTaskBodySchema,
  type ClaimTaskBody,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError } from "../_shared/handler.js";
import {
  assertNoClientControlledTaskFields,
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  compactRecord,
  isRecord,
  mapTaskRpcError,
  parseTaskJsonBodyInput,
  readBoolean,
  readIsoDateString,
  readString,
  withTaskApiHandler,
} from "./_shared.js";
import { assertUserRiskAllowed } from "../_shared/riskGuards.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = await parseTaskJsonBodyInput(req, ClaimTaskBodySchema, {
      maxBytes: 8 * 1024,
      normalize: normalizeClaimTaskInput,
    });
    await assertUserRiskAllowed({
      req,
      ctx,
      session: ctx.session,
      action: "tasks.claim",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        taskId: input.taskId,
        periodKey: input.periodKey ?? undefined,
      },
    });
    const payload = await callClaimTaskRpc(input, ctx.session, ctx.requestId);

    return normalizeClaimTaskPayload(payload, input.taskId);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.claim",
    },
  },
);

export function normalizeClaimTaskInput(
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
    "任务领奖请求不能携带用户身份、进度或奖励字段。",
  );

  return {
    taskId: body.taskId ?? body.task_id,
    periodKey: body.periodKey ?? body.period_key,
    idempotencyKey,
  };
}

async function callClaimTaskRpc(
  input: ClaimTaskBody,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "task_claim_reward",
      session,
      {
        p_task_id: input.taskId,
        p_period_key: input.periodKey ?? null,
        p_idempotency_key: input.idempotencyKey,
      },
      {
        requestId,
        idempotencyKey: input.idempotencyKey,
        taskId: input.taskId,
        periodKey: input.periodKey ?? null,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "TASK_CLAIM_RPC_FAILED",
      "领取任务奖励失败，请稍后重试。",
    );
  }
}

export function normalizeClaimTaskPayload(
  payload: unknown,
  fallbackTaskId: string,
) {
  const result = assertTaskRecordPayload(
    payload,
    "TASK_CLAIM_RESULT_INVALID",
    "任务领奖结果格式无效。",
  );
  const taskId = readString(result.task_id) ?? fallbackTaskId;
  const claimedAt = readIsoDateString(result.claimed_at);

  if (!claimedAt) {
    throw new ApiError(
      500,
      "TASK_CLAIM_RESULT_INVALID",
      "任务领奖结果缺少必要字段。",
      {
        details: {
          claimed_at: result.claimed_at,
        },
        expose: false,
      },
    );
  }

  return compactRecord({
    claim_id: readString(result.claim_id),
    task_id: taskId,
    period_key: readString(result.period_key),
    status: readString(result.status) ?? "claimed",
    rewards: Array.isArray(result.rewards)
      ? result.rewards
      : Array.isArray(result.reward)
        ? result.reward
        : [],
    ledger_results: Array.isArray(result.ledger_results)
      ? result.ledger_results
      : [],
    claimed_at: claimedAt,
    idempotent: readBoolean(result.idempotent) ?? false,
  });
}
