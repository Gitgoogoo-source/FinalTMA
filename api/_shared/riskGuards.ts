import type { VercelRequest } from "@vercel/node";

import {
  createRiskControl,
  RiskControlError,
  type RiskAction,
  type RiskAssessment,
} from "../../packages/server/src/security/riskControl.js";
import { ApiError, type ApiContext } from "./handler.js";
import { getSupabaseAdmin, type SessionContext } from "./requireSession.js";

export type UserRiskGuardInput = {
  req: VercelRequest;
  ctx: ApiContext;
  session: Pick<SessionContext, "sessionId" | "userId" | "telegramUserId">;
  action: RiskAction;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
};

export async function assertUserRiskAllowed(
  input: UserRiskGuardInput,
): Promise<void> {
  const riskControl = createRiskControl({
    supabase: getSupabaseAdmin(),
    enableRateLimit: false,
  });

  try {
    await riskControl.assertAllowed(
      {
        action: input.action,
        userId: input.session.userId,
        sessionId: input.session.sessionId,
        headers: input.req.headers,
        method: input.ctx.method,
        ...(input.session.telegramUserId !== null
          ? { telegramUserId: input.session.telegramUserId }
          : {}),
        ...(input.req.url ? { path: input.req.url } : {}),
        ...(input.ctx.ip ? { ip: input.ctx.ip } : {}),
        ...(input.ctx.userAgent ? { userAgent: input.ctx.userAgent } : {}),
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        skipRateLimit: true,
        skipEventWrite: true,
      },
      {
        failOnDecision: ["deny"],
      },
    );
  } catch (error) {
    if (error instanceof RiskControlError) {
      throw toRiskRejectedApiError(error);
    }

    throw error;
  }
}

function toRiskRejectedApiError(error: RiskControlError): ApiError {
  return new ApiError(
    error.statusCode,
    "RISK_REJECTED",
    "当前操作存在风险，已被系统拦截。",
    {
      details: toSafeRiskDetails(error.assessment),
      cause: error,
    },
  );
}

function toSafeRiskDetails(
  assessment: RiskAssessment,
): Record<string, unknown> {
  return {
    decision: assessment.decision,
    severity: assessment.severity,
    score: assessment.score,
    signals: assessment.signals.map((signal) => ({
      code: signal.code,
      severity: signal.severity,
      score: signal.score,
      ...(signal.decision ? { decision: signal.decision } : {}),
    })),
    requiredActions: assessment.requiredActions,
  };
}
