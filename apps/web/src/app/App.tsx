import { useEffect, useState, type ReactNode } from "react";

import { retryRecoveredBootstrap } from "../platform/api/client.ts";
import { useSession } from "../platform/session/store.ts";
import { useBootstrap } from "../workflows/session-bootstrap/index.ts";
import { AccountGate } from "./guards/AccountGate.tsx";
import { AuthenticatedRuntimeProviders } from "./providers/AuthenticatedRuntimeProviders.tsx";
import { AppRouter } from "./router/AppRouter.tsx";
import { StartupScreen } from "./StartupScreen.tsx";

export function App(): ReactNode {
  const bootstrap = useBootstrap();
  const session = useSession();
  if (bootstrap.phase === "banned" || session?.accountStatus === "banned")
    return null;
  if (session?.recovering)
    return (
      <StartupScreen
        title="正在找回冒险"
        message="请稍候，伙伴们正在重新集合"
      />
    );
  if (session?.entryHandoffState === "pending" && bootstrap.phase === "ready")
    return (
      <StartupScreen
        title="正在确认同行关系"
        message="请稍候，冒险伙伴即将会合"
      />
    );
  if (session?.bootstrapFailed) return <RecoveredBootstrapFailure />;
  if (!bootstrap.failed && bootstrap.phase !== "ready")
    return (
      <StartupScreen
        title={
          bootstrap.phase === "settling_referral"
            ? "正在确认同行关系"
            : bootstrap.phase === "loading_bootstrap"
              ? "正在准备冒险"
              : "正在进入游戏"
        }
        message="请稍候，冒险正在苏醒"
      />
    );
  if (bootstrap.failed)
    return (
      <StartupScreen
        failed
        title={
          bootstrap.phase === "bootstrap_failed"
            ? "冒险准备失败"
            : bootstrap.phase === "settling_referral"
              ? "同行关系尚未确认"
              : "暂时无法进入游戏"
        }
        message={bootstrap.message}
        retryLabel={bootstrap.canRetry ? bootstrap.retryLabel : undefined}
        onRetry={bootstrap.canRetry ? bootstrap.retry : undefined}
      />
    );
  if (!session)
    return (
      <StartupScreen
        failed
        title="登录状态已失效"
        message="请重新从 Telegram 打开游戏"
      />
    );
  return (
    <AccountGate restricted={false}>
      <AuthenticatedRuntimeProviders>
        <AppRouter />
        {bootstrap.notice ? (
          <EntryNotice key={bootstrap.notice} message={bootstrap.notice} />
        ) : null}
      </AuthenticatedRuntimeProviders>
    </AccountGate>
  );
}

function EntryNotice({ message }: { message: string }): ReactNode {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return visible ? <div className="entry-notice">{message}</div> : null;
}

function RecoveredBootstrapFailure(): ReactNode {
  const [submitting, setSubmitting] = useState(false);
  return (
    <StartupScreen
      failed
      title="冒险准备失败"
      message="暂时没能准备好，请重新尝试。"
      retryLabel="重新尝试"
      retryDisabled={submitting}
      onRetry={() => {
        setSubmitting(true);
        void retryRecoveredBootstrap()
          .catch(() => undefined)
          .finally(() => setSubmitting(false));
      }}
    />
  );
}
