import { useCallback, useEffect, useRef, useState } from "react";

import {
  apiRequest,
  ApiFailure,
  newIdempotencyKey,
} from "../../platform/api/client.ts";
import { queryClient } from "../../platform/query/index.ts";
import { replaceSession, type Session } from "../../platform/session/store.ts";
import { initializeTelegram } from "../../platform/telegram/index.ts";

type BootstrapState = {
  phase: "loading" | "ready" | "banned" | "failed";
  message: string;
  session: Session | null;
};

export function useBootstrap(): BootstrapState & { retry(): void } {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<BootstrapState>({
    phase: "loading",
    message: "正在进入游戏",
    session: null,
  });
  const generation = useRef(0);
  const referralOperation = useRef(newIdempotencyKey());
  useEffect(() => {
    const current = ++generation.current;
    void (async () => {
      const app = initializeTelegram();
      if (!app?.initData) {
        setState({
          phase: "failed",
          message: "请从 Telegram Mini App 打开应用",
          session: null,
        });
        return;
      }
      setState({
        phase: "loading",
        message: "正在校验 Telegram 登录状态",
        session: null,
      });
      try {
        const login = await apiRequest(
          "identity.authenticate",
          { init_data: app.initData },
          { recoverSession: false },
        );
        if (current !== generation.current) return;
        const session = {
          token: login.data.access_token,
          userId: login.data.user_id,
          accountStatus: login.data.account_status,
          expiresAt: login.data.expires_at,
          generation: crypto.randomUUID(),
        } satisfies Session;
        replaceSession(session);
        queryClient.clear();
        if (session.accountStatus === "banned") {
          setState({ phase: "banned", message: "", session });
          return;
        }
        if (login.data.start_param?.toUpperCase().startsWith("TMA")) {
          const code = login.data.start_param.toUpperCase();
          if (!/^TMA[A-F0-9]{20}$/.test(code))
            throw new Error("邀请入口无效，请重新通过原邀请链接进入");
          setState({
            phase: "loading",
            message: "正在确认邀请关系",
            session,
          });
          await settleReferralCandidate(code, referralOperation.current);
        }
        setState({
          phase: "loading",
          message: "正在加载当前账号数据",
          session,
        });
        await apiRequest("identity.bootstrap", {});
        if (current === generation.current)
          setState({ phase: "ready", message: "", session });
      } catch (cause) {
        if (current !== generation.current) return;
        replaceSession(null);
        const error = cause instanceof ApiFailure ? cause : null;
        const message =
          error?.code === "NETWORK_ERROR"
            ? "网络请求失败，请检查网络后重试"
            : (error?.message ?? "登录失败，请稍后重试");
        setState({ phase: "failed", message, session: null });
      }
    })();
    return () => {
      generation.current += 1;
    };
  }, [version]);
  const retry = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, retry };
}

async function settleReferralCandidate(
  code: string,
  idempotencyKey: string,
): Promise<void> {
  try {
    await apiRequest("referral.bind", { code }, { idempotencyKey });
  } catch (cause) {
    if (!(cause instanceof ApiFailure)) throw cause;
    if (cause.code.startsWith("REFERRAL_") && cause.code !== "RATE_LIMITED")
      return;
    if (!cause.operationId) throw cause;
    try {
      const recovered = await apiRequest("operations.get", {
        operation_id: cause.operationId,
      });
      if (["succeeded", "failed"].includes(String(recovered.data.status)))
        return;
    } catch (recoveryCause) {
      if (
        recoveryCause instanceof ApiFailure &&
        recoveryCause.code === "OPERATION_NOT_FOUND"
      ) {
        await apiRequest("referral.bind", { code }, { idempotencyKey }).catch(
          (retryCause: unknown) => {
            if (
              !(
                retryCause instanceof ApiFailure &&
                retryCause.code.startsWith("REFERRAL_")
              )
            )
              throw retryCause;
          },
        );
        return;
      }
      throw recoveryCause;
    }
    throw cause;
  }
}
