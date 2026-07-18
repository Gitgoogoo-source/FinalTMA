import { createHash, createHmac, randomBytes } from "node:crypto";

import { rpc } from "./db/index.ts";
import { getEnv } from "./env/index.ts";

export type Session = {
  session_id: string;
  user_id: string;
  account_status: "normal" | "banned";
  expires_at: string;
  session_state: "active" | "expired" | "replaced";
};

export function issueToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
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
    throw new Error("SESSION_REQUIRED:请从 Telegram 重新打开 Mini App");
  const token = authorization.slice(7).trim();
  const session = await rpc<Session | null>("resolve_session", {
    p_token_hash: hashToken(token),
  });
  if (!session)
    throw new Error("SESSION_REQUIRED:请从 Telegram 重新打开 Mini App");
  if (session.account_status === "banned")
    throw new Error("ACCOUNT_RESTRICTED:账号不可用");
  if (session.session_state === "replaced")
    throw new Error("SESSION_REPLACED:会话已被新登录替换");
  if (session.session_state === "expired")
    throw new Error("SESSION_EXPIRED:会话已过期");
  return session;
}
