import { callRpcRaw } from "../../packages/server/src/db/rpc.js";

export type RecordRiskEventInput = {
  userId?: string | null;
  eventType: string;
  severity?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  scoreDelta?: number | null;
  detail?: Record<string, unknown>;
  idempotencyKey: string;
  context?: Record<string, unknown>;
};

export async function recordRiskEvent(
  input: RecordRiskEventInput,
): Promise<Record<string, unknown>> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("risk_record_event requires an idempotency key");
  }

  return callRpcRaw<Record<string, unknown>>(
    "risk_record_event",
    {
      p_user_id: input.userId ?? null,
      p_event_type: input.eventType,
      p_severity: input.severity ?? null,
      p_source_type: input.sourceType ?? null,
      p_source_id: input.sourceId ?? null,
      p_score_delta: input.scoreDelta ?? null,
      p_detail: input.detail ?? {},
      p_idempotency_key: input.idempotencyKey,
    },
    {
      schema: "api" as never,
      ...(input.context ? { context: input.context } : {}),
    },
  );
}

export async function recordRiskEventSafely(
  input: RecordRiskEventInput,
): Promise<void> {
  try {
    await recordRiskEvent(input);
  } catch (error) {
    console.error("[risk-event:record-failed]", {
      eventType: input.eventType,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      userId: input.userId ?? null,
      requestId: input.context?.requestId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
