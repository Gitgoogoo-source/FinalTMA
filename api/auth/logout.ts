import { AuthLogoutRequestSchema } from "../../packages/validation/src/auth.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { parseOptionalJsonBody } from "../_shared/parseBody.js";
import { getSupabaseAdmin, requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import { buildExpiredAuthSessionCookie } from "./_sessionCookies.js";

type RevokedSessionRow = {
  id: string;
};

export default withApiHandler(
  async (req, res) => {
    const session = await requireSession(req, {
      requireActiveUser: false,
      touchLastSeen: false,
    });
    const body = await parseOptionalJsonBody<unknown>(req, {
      maxBytes: 4 * 1024,
    });
    const input = validate(AuthLogoutRequestSchema, body ?? {});
    const revokedSessionCount = await revokeSessions(getSupabaseAdmin(), {
      userId: session.userId,
      sessionId: session.sessionId,
      sessionTokenHash: session.sessionTokenHash,
      allDevices: input.allDevices,
    });

    res.setHeader("Set-Cookie", buildExpiredAuthSessionCookie());

    return {
      status: "ok",
      revokedSessionCount,
    };
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "auth.logout",
    },
  },
);

async function revokeSessions(
  db: ReturnType<typeof getSupabaseAdmin>,
  input: {
    userId: string;
    sessionId: string;
    sessionTokenHash: string;
    allDevices: boolean;
  },
): Promise<number> {
  let query = db
    .schema("core")
    .from("app_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId)
    .is("revoked_at", null);

  if (!input.allDevices) {
    query = query
      .eq("id", input.sessionId)
      .eq("session_token_hash", input.sessionTokenHash);
  }

  const { data, error } = await query.select("id");

  if (error) {
    throw new ApiError(500, "AUTH_LOGOUT_UPDATE_FAILED", "退出登录失败。", {
      cause: error,
      expose: false,
    });
  }

  return Array.isArray(data) ? (data as RevokedSessionRow[]).length : 0;
}
