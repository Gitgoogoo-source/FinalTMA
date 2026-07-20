import { createHash, createHmac } from "node:crypto";

import { rpc } from "./db/index.ts";
import { getEnv } from "./env/index.ts";
import { ApiError } from "../http/errors.ts";

export type Session = {
  session_id: string;
  user_id: string;
  account_status: "normal" | "banned";
  expires_at: string;
  session_state: "active" | "expired" | "replaced";
  entry_handoff_state: "pending" | "complete";
  entry_handoff_code: string | null;
  entry_handoff_result:
    | "REFERRAL_BOUND"
    | "REFERRAL_ALREADY_BOUND"
    | "REFERRAL_ALREADY_RECHARGED"
    | "REFERRAL_CANDIDATE_EXPIRED"
    | "REFERRAL_CODE_INVALID"
    | "REFERRAL_INELIGIBLE"
    | "REFERRAL_INVITER_UNAVAILABLE"
    | "REFERRAL_OLD_USER"
    | "REFERRAL_SELF_BIND"
    | null;
};

export function issueToken(operationId: string): {
  token: string;
  hash: string;
} {
  const token = createHmac("sha256", getEnv().IDENTITY_SECURITY_SECRET)
    .update(`pokepets-login-token-v1:${operationId}`)
    .digest("base64url");
  return { token, hash: hashToken(token) };
}

export function identityFingerprint(domain: string, value: string): string {
  return createHmac("sha256", getEnv().IDENTITY_SECURITY_SECRET)
    .update(`pokepets-identity-v1:${domain}:${value}`)
    .digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function referralCode(telegramId: number): string {
  const signature = createHmac("sha256", getEnv().REFERRAL_CODE_SECRET)
    .update(`pokepets-referral-v1:${telegramId}`)
    .digest("hex")
    .slice(0, 20);
  return `TMA${signature.toUpperCase()}`;
}

export async function resolveSession(request: Request): Promise<Session> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    throw new ApiError(
      401,
      "SESSION_REQUIRED",
      "请从 Telegram 重新打开 Mini App",
    );
  const token = authorization.slice(7).trim();
  const session = await rpc<Session | null>("identity_resolve_session", {
    p_token_hash: hashToken(token),
  });
  if (!session)
    throw new ApiError(
      401,
      "SESSION_REQUIRED",
      "请从 Telegram 重新打开 Mini App",
    );
  if (session.account_status === "banned")
    throw new ApiError(403, "ACCOUNT_RESTRICTED", "账号不可用");
  if (session.session_state === "replaced")
    throw new ApiError(401, "SESSION_REPLACED", "会话已被新登录替换");
  if (session.session_state === "expired")
    throw new ApiError(401, "SESSION_EXPIRED", "会话已过期");
  return session;
}
