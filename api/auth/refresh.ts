import {
  AuthRefreshSessionRequestSchema,
  type AuthClientContext,
} from "../../packages/validation/src/auth.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { parseOptionalJsonBody } from "../_shared/parseBody.js";
import {
  extractSessionToken,
  getSupabaseAdmin,
  requireSession,
} from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import { buildAuthSessionCookie } from "./_sessionCookies.js";

type SessionUserRow = {
  id: string;
  telegram_user_id: number | string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  photo_url: string | null;
  invite_code: string | null;
  status: string;
};

type RefreshedSessionRow = {
  id: string;
  expires_at: string;
};

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export default withApiHandler(
  async (req, res) => {
    const session = await requireSession(req, {
      touchLastSeen: false,
    });
    const body = await parseOptionalJsonBody<unknown>(req, {
      maxBytes: 8 * 1024,
    });
    const input = validate(AuthRefreshSessionRequestSchema, body ?? {});
    const token = extractSessionToken(req);

    if (!token) {
      throw ApiError.authSessionExpired("登录状态缺失，请重新进入应用。");
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + SESSION_TTL_SECONDS * 1000,
    ).toISOString();
    const db = getSupabaseAdmin();
    const refreshed = await refreshCurrentSession(db, {
      sessionId: session.sessionId,
      sessionTokenHash: session.sessionTokenHash,
      userId: session.userId,
      expiresAt,
      platform: input.clientContext?.platform ?? null,
    });
    const user = await loadSessionUser(db, session.userId);

    res.setHeader(
      "Set-Cookie",
      buildAuthSessionCookie(token, SESSION_TTL_SECONDS),
    );

    return {
      status: "ok",
      user: toSessionUser(user),
      session: {
        sessionId: refreshed.id,
        expiresAt: refreshed.expires_at,
        expiresInSeconds: SESSION_TTL_SECONDS,
        cookieBased: true,
      },
    };
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "auth.refresh",
    },
  },
);

async function refreshCurrentSession(
  db: ReturnType<typeof getSupabaseAdmin>,
  input: {
    sessionId: string;
    sessionTokenHash: string;
    userId: string;
    expiresAt: string;
    platform: AuthClientContext["platform"] | null;
  },
): Promise<RefreshedSessionRow> {
  const updatePayload: Record<string, string> = {
    expires_at: input.expiresAt,
    last_seen_at: new Date().toISOString(),
  };

  if (input.platform) {
    updatePayload.platform = input.platform;
  }

  const { data, error } = await db
    .schema("core")
    .from("app_sessions")
    .update(updatePayload)
    .eq("id", input.sessionId)
    .eq("user_id", input.userId)
    .eq("session_token_hash", input.sessionTokenHash)
    .is("revoked_at", null)
    .select("id,expires_at")
    .maybeSingle<RefreshedSessionRow>();

  if (error) {
    throw new ApiError(
      500,
      "AUTH_REFRESH_UPDATE_FAILED",
      "刷新登录状态失败。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  if (!data) {
    throw ApiError.authSessionExpired("登录状态已失效，请重新进入应用。");
  }

  return data;
}

async function loadSessionUser(
  db: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<SessionUserRow> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select(
      "id,telegram_user_id,username,first_name,last_name,language_code,photo_url,invite_code,status",
    )
    .eq("id", userId)
    .maybeSingle<SessionUserRow>();

  if (error) {
    throw new ApiError(500, "USER_LOOKUP_FAILED", "查询用户失败。", {
      cause: error,
      expose: false,
    });
  }

  if (!data || data.status !== "active") {
    throw ApiError.userBlocked("当前账号已被限制使用。", {
      status: data?.status ?? "missing",
    });
  }

  return data;
}

function toSessionUser(user: SessionUserRow) {
  return {
    id: user.id,
    telegramUserId: String(user.telegram_user_id),
    username: user.username,
    firstName: user.first_name ?? "",
    lastName: user.last_name,
    languageCode: user.language_code,
    avatarUrl: user.photo_url,
    inviteCode: user.invite_code,
  };
}
