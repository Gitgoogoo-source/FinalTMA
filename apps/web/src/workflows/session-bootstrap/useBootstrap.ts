import { useCallback, useEffect, useRef, useState } from "react";
import { errorDefinition, isErrorCode } from "@pokepets/api-contracts/app";

import {
  apiRequest,
  ApiFailure,
  newIdempotencyKey,
  resetSessionRecovery,
} from "../../platform/api/client.ts";
import { prefetchApiQuery, seedApiQuery } from "../../platform/query/index.ts";
import {
  clearSensitiveState,
  getSession,
  replaceSession,
  type Session,
} from "../../platform/session/store.ts";
import { initializeTelegram } from "../../platform/telegram/index.ts";

export type BootstrapPhase =
  | "initializing"
  | "validating_telegram"
  | "authenticating"
  | "settling_referral"
  | "loading_bootstrap"
  | "bootstrap_failed"
  | "ready"
  | "reentry_required"
  | "banned";

type RetryTarget = "login" | "referral" | "bootstrap";
type BootstrapState = {
  phase: BootstrapPhase;
  message: string;
  session: Session | null;
  canRetry: boolean;
  failed: boolean;
  retryLabel: "重新尝试" | "继续确认";
  notice: string | null;
};
type LoginContext = {
  session: Session;
  startParam: string | null;
  notice: string | null;
};

const initialState: BootstrapState = {
  phase: "initializing",
  message: "正在进入游戏",
  session: null,
  canRetry: false,
  failed: false,
  retryLabel: "重新尝试",
  notice: null,
};

export function useBootstrap(): BootstrapState & { retry(): void } {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<BootstrapState>(initialState);
  const generation = useRef(0);
  const retryTarget = useRef<RetryTarget>("login");
  const loginOperation = useRef(newIdempotencyKey());
  const referralOperation = useRef(newIdempotencyKey());
  const referralResubmitted = useRef(false);
  const referralQueryOnly = useRef(false);
  const loginContext = useRef<LoginContext | null>(null);
  const recoveryInitialized = useRef(false);

  useEffect(() => {
    if (!recoveryInitialized.current) {
      resetSessionRecovery();
      recoveryInitialized.current = true;
    }
    const current = ++generation.current;
    const controller = new AbortController();
    const target = retryTarget.current;
    let stage: RetryTarget = target;
    const active = () =>
      current === generation.current && !controller.signal.aborted;

    void (async () => {
      try {
        if (target === "login") {
          const app = initializeTelegram();
          if (!app?.initData) {
            setState({
              ...initialState,
              phase: "reentry_required",
              message: "请从 Telegram Mini App 打开应用",
              failed: true,
            });
            return;
          }
          setState({
            ...initialState,
            phase: "validating_telegram",
            message: "正在校验 Telegram 登录状态",
          });
          await nextFrame();
          if (!active()) return;
          setState({
            ...initialState,
            phase: "authenticating",
            message: "正在登录，请稍候",
          });
          const login = await apiRequest(
            "identity.authenticate",
            { init_data: app.initData },
            {
              idempotencyKey: loginOperation.current,
              recoverSession: false,
              signal: controller.signal,
            },
          );
          if (!active()) return;
          if (login.data.account_status === "banned") {
            clearSensitiveState();
            replaceSession(null);
            setState({ ...initialState, phase: "banned" });
            return;
          }
          const session = {
            token: login.data.access_token,
            userId: login.data.user_id,
            accountStatus: "normal",
            expiresAt: login.data.expires_at,
            generation: crypto.randomUUID(),
          } satisfies Session;
          clearSensitiveState();
          replaceSession(session);
          window.history.replaceState({}, "", "/");
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
          loginContext.current = {
            session,
            startParam: login.data.start_param,
            notice: null,
          };
        }

        const context = loginContext.current;
        if (!context || getSession()?.accountStatus !== "normal") {
          setState({
            ...initialState,
            phase: "reentry_required",
            message: "请从 Telegram Mini App 重新打开应用",
            failed: true,
          });
          return;
        }

        if (target !== "bootstrap" && context.startParam) {
          stage = "referral";
          setState({
            ...initialState,
            phase: "settling_referral",
            message: "正在确认邀请关系",
            session: context.session,
          });
          const settlement = await settleReferralCandidate(
            context.startParam,
            referralOperation.current,
            referralResubmitted,
            referralQueryOnly,
            controller.signal,
          );
          if (!active()) return;
          if (settlement.kind === "pending") {
            retryTarget.current = "referral";
            setState({
              ...initialState,
              phase: "settling_referral",
              message: settlement.message,
              session: context.session,
              canRetry: true,
              failed: true,
              retryLabel: "继续确认",
            });
            return;
          }
          context.notice = settlement.notice;
          context.startParam = null;
        }

        retryTarget.current = "bootstrap";
        stage = "bootstrap";
        setState({
          ...initialState,
          phase: "loading_bootstrap",
          message: "正在加载当前账号数据",
          session: getSession(),
          notice: context.notice,
        });
        const bootstrap = await apiRequest(
          "identity.bootstrap",
          {},
          { signal: controller.signal },
        );
        if (!active()) return;
        const currentSession = getSession();
        if (!currentSession || currentSession.accountStatus !== "normal")
          return;
        seedApiQuery("identity.bootstrap", {}, bootstrap.data);
        prefetchSummaries(currentSession.generation);
        setState({
          ...initialState,
          phase: "ready",
          session: currentSession,
          notice: context.notice,
        });
      } catch (cause) {
        if (!active()) return;
        const failure = toFailure(cause);
        if (
          failure.code === "ACCOUNT_RESTRICTED" ||
          getSession()?.accountStatus === "banned"
        ) {
          setState({ ...initialState, phase: "banned" });
          return;
        }
        const session = getSession();
        if (stage === "bootstrap" && session?.accountStatus === "normal") {
          if (session.bootstrapFailed)
            replaceSession({ ...session, bootstrapFailed: false });
          retryTarget.current = "bootstrap";
          setState({
            ...initialState,
            phase: "bootstrap_failed",
            message: "数据加载失败，请重试。",
            session,
            canRetry: true,
            failed: true,
            notice: loginContext.current?.notice ?? null,
          });
          return;
        }
        if (stage === "referral" && session?.accountStatus === "normal") {
          retryTarget.current = "referral";
          setState({
            ...initialState,
            phase: "settling_referral",
            message: "邀请绑定结果确认中，请稍后刷新",
            session,
            canRetry: true,
            failed: true,
            retryLabel: "继续确认",
          });
          return;
        }
        if (isCurrentPageLoginRetry(failure.code)) {
          retryTarget.current = "login";
          clearSensitiveState();
          replaceSession(null);
          setState({
            ...initialState,
            phase: "authenticating",
            message: loginFailureMessage(failure),
            canRetry: true,
            failed: true,
          });
          return;
        }
        clearSensitiveState();
        replaceSession(null);
        setState({
          ...initialState,
          phase: "reentry_required",
          message: loginFailureMessage(failure),
          failed: true,
        });
      }
    })();

    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [version]);

  const retry = useCallback(() => {
    setState((current) => ({
      ...current,
      canRetry: false,
      failed: false,
      message:
        retryTarget.current === "referral"
          ? "正在确认邀请关系"
          : retryTarget.current === "bootstrap"
            ? "正在加载当前账号数据"
            : "正在登录，请稍候",
    }));
    setVersion((value) => value + 1);
  }, []);
  return { ...state, retry };
}

async function settleReferralCandidate(
  code: string,
  operationId: string,
  resubmitted: { current: boolean },
  queryOnly: { current: boolean },
  signal: AbortSignal,
): Promise<
  { kind: "settled"; notice: string } | { kind: "pending"; message: string }
> {
  if (!queryOnly.current) {
    try {
      await apiRequest(
        "referral.bind",
        { code },
        { idempotencyKey: operationId, signal },
      );
      return {
        kind: "settled",
        notice: "邀请关系已绑定，完成首次有效充值后可为邀请人解锁奖励",
      };
    } catch (cause) {
      const failure = toFailure(cause);
      if (isSettledReferralError(failure.code))
        return { kind: "settled", notice: failure.message };
      if (!isUnknownReferralResult(failure.code)) throw failure;
      queryOnly.current = true;
    }
  }

  try {
    const recovered = await apiRequest(
      "operations.get",
      { operation_id: operationId },
      { signal },
    );
    if (recovered.data.status === "succeeded")
      return {
        kind: "settled",
        notice: "邀请关系已绑定，完成首次有效充值后可为邀请人解锁奖励",
      };
    if (recovered.data.status === "failed") {
      const code = recovered.data.error_code;
      return {
        kind: "settled",
        notice:
          code && isErrorCode(code)
            ? errorDefinition(code).message
            : "当前账号暂不符合邀请绑定条件",
      };
    }
    return { kind: "pending", message: "邀请绑定结果确认中，请稍后刷新" };
  } catch (cause) {
    const failure = toFailure(cause);
    if (failure.code === "OPERATION_NOT_FOUND" && !resubmitted.current) {
      resubmitted.current = true;
      queryOnly.current = false;
      return settleReferralCandidate(
        code,
        operationId,
        resubmitted,
        queryOnly,
        signal,
      );
    }
    if (["NETWORK_ERROR", "OPERATION_NOT_FOUND"].includes(failure.code))
      return { kind: "pending", message: "邀请绑定结果确认中，请稍后刷新" };
    throw failure;
  }
}

const settledReferralErrors = new Set([
  "REFERRAL_ALREADY_BOUND",
  "REFERRAL_ALREADY_RECHARGED",
  "REFERRAL_CANDIDATE_EXPIRED",
  "REFERRAL_CODE_INVALID",
  "REFERRAL_INELIGIBLE",
  "REFERRAL_INVITER_UNAVAILABLE",
  "REFERRAL_OLD_USER",
  "REFERRAL_SELF_BIND",
]);

function isSettledReferralError(code: string): boolean {
  return settledReferralErrors.has(code);
}

function isUnknownReferralResult(code: string): boolean {
  return [
    "NETWORK_ERROR",
    "DATABASE_RPC_FAILED",
    "INTERNAL_ERROR",
    "OPERATION_RESULT_INVALID",
    "RESPONSE_INVALID",
  ].includes(code);
}

function toFailure(cause: unknown): ApiFailure {
  return cause instanceof ApiFailure
    ? cause
    : new ApiFailure(500, "INTERNAL_ERROR", "登录失败，请稍后重试", true, null);
}

function isCurrentPageLoginRetry(code: string): boolean {
  return [
    "NETWORK_ERROR",
    "INTERNAL_ERROR",
    "DATABASE_RPC_FAILED",
    "RESPONSE_INVALID",
  ].includes(code);
}

function loginFailureMessage(failure: ApiFailure): string {
  const messages: Record<string, string> = {
    NETWORK_ERROR: "网络请求失败，请检查网络后重试",
    INTERNAL_ERROR: "登录失败，请稍后重试",
    DATABASE_RPC_FAILED: "登录失败，请稍后重试",
    RESPONSE_INVALID: "登录失败，请稍后重试",
    TELEGRAM_INIT_DATA_EXPIRED: "登录凭证已过期，请重新进入应用",
    TELEGRAM_INIT_DATA_TIME_INVALID:
      "Telegram 登录凭证时间无效，请重新进入应用",
    TELEGRAM_INIT_DATA_INVALID: "Telegram 登录校验失败，请重新进入应用",
    TELEGRAM_START_PARAM_INVALID: "入口参数无效，请重新从 Telegram 进入应用",
  };
  return messages[failure.code] ?? failure.message;
}

function prefetchSummaries(sessionGeneration: string): void {
  if (getSession()?.generation !== sessionGeneration) return;
  void prefetchApiQuery("vip.get");
  void prefetchApiQuery("wallet.get");
  void prefetchApiQuery("gacha.bootstrap");
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
