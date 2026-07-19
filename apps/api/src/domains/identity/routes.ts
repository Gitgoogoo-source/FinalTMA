import { createHash } from "node:crypto";

import { rpc } from "../../platform/db/index.ts";
import { getEnv } from "../../platform/env/index.ts";
import { issueToken, referralCode } from "../../platform/session.ts";
import { verifyTelegramInitData } from "../../platform/telegram/initData.ts";
import { requireSession, type HandlerMap } from "../../http/handlers.ts";

export const identityHandlers = {
  "identity.authenticate": async (context) => {
    const initData = String(context.input.init_data);
    const source =
      context.request.headers
        .get("x-vercel-forwarded-for")
        ?.split(",")[0]
        ?.trim() ??
      context.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      context.request.headers.get("x-real-ip")?.trim() ??
      "unknown";
    await rpc("identity_check_rate_limit", {
      p_key_hash: digest(`source:${source}`),
    });
    const verified = verifyTelegramInitData(initData, {
      botToken: getEnv().TELEGRAM_BOT_TOKEN,
    });
    if (verified.user.is_bot)
      throw new Error("TELEGRAM_INIT_DATA_INVALID:机器人账号不能登录");
    await rpc("identity_check_rate_limit", {
      p_key_hash: digest(`user:${verified.user.id}`),
    });
    await rpc("identity_check_rate_limit", {
      p_key_hash: digest(`init:${initData}`),
    });
    const issued = issueToken();
    const session = await rpc<{
      user_id: string;
      account_status: "normal" | "banned";
      expires_at: string;
    }>("identity_create_session", {
      p_telegram_id: verified.user.id,
      p_username: verified.user.username ?? null,
      p_first_name: verified.user.first_name,
      p_last_name: verified.user.last_name ?? null,
      p_language_code: verified.user.language_code ?? null,
      p_referral_code: referralCode(verified.user.id),
      p_token_hash: issued.hash,
      p_auth_date: verified.authDate.toISOString(),
      p_expires_at: issued.expiresAt.toISOString(),
      p_start_param: verified.startParam ?? null,
    });
    return {
      data: {
        access_token: issued.token,
        user_id: session.user_id,
        account_status: session.account_status,
        expires_at: session.expires_at,
        start_param: verified.startParam ?? null,
      },
    };
  },
  "identity.bootstrap": async (context) => ({
    data: await rpc("identity_bootstrap", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
} satisfies HandlerMap;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
