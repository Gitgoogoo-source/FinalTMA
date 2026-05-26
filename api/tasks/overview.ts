import {
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  isRecord,
  mapTaskRpcError,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (_req, _res, ctx) => {
    const payload = await callTaskOverviewRpc(ctx.session, ctx.requestId);

    return normalizeTaskOverviewPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "tasks.overview",
    },
  },
);

async function callTaskOverviewRpc(
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "get_user_task_center",
      session,
      {},
      {
        requestId,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "TASK_OVERVIEW_RPC_FAILED",
      "获取任务概览失败，请稍后重试。",
    );
  }
}

export function normalizeTaskOverviewPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "TASK_OVERVIEW_RESULT_INVALID",
    "任务概览结果格式无效。",
  );
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  const signinStatus = result.signin_status ?? result.signin ?? null;
  const inviteStats = isRecord(result.invite_stats) ? result.invite_stats : {};
  const commissionStats = isRecord(result.commission_stats)
    ? result.commission_stats
    : isRecord(inviteStats.commissions)
      ? inviteStats.commissions
      : {};

  return {
    tasks,
    signin_status: signinStatus,
    invite_stats: inviteStats,
    commission_stats: commissionStats,
    task_summary: isRecord(result.task_summary) ? result.task_summary : {},
    referral_records: Array.isArray(result.referral_records)
      ? result.referral_records
      : [],
    commission_history: Array.isArray(result.commission_history)
      ? result.commission_history
      : [],
    balances: isRecord(result.balances) ? result.balances : {},
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
