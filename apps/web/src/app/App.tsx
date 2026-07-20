import { LoaderCircle, RotateCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "../shared/ui/index.tsx";
import { retryRecoveredBootstrap } from "../platform/api/client.ts";
import { useSession } from "../platform/session/store.ts";
import { useBootstrap } from "../workflows/session-bootstrap/index.ts";
import { AccountGate } from "./guards/AccountGate.tsx";
import { AppRouter } from "./router/AppRouter.tsx";

export function App(): ReactNode {
  const bootstrap = useBootstrap();
  const session = useSession();
  if (bootstrap.phase === "banned" || session?.accountStatus === "banned")
    return null;
  if (session?.recovering)
    return (
      <main className="startup">
        <div className="brand-orbit">
          <i />
          <strong>PP</strong>
        </div>
        <h1>PokePets</h1>
        <p>正在恢复会话并读取真实状态</p>
        <LoaderCircle className="spin" />
      </main>
    );
  if (session?.entryHandoffState === "pending" && bootstrap.phase === "ready")
    return (
      <main className="startup">
        <div className="brand-orbit">
          <i />
          <strong>PP</strong>
        </div>
        <h1>邀请关系确认中</h1>
        <p>正在恢复原邀请绑定结果</p>
        <LoaderCircle className="spin" />
      </main>
    );
  if (session?.bootstrapFailed) return <RecoveredBootstrapFailure />;
  if (!bootstrap.failed && bootstrap.phase !== "ready")
    return (
      <main className="startup">
        <div className="brand-orbit">
          <i />
          <strong>PP</strong>
        </div>
        <h1>PokePets</h1>
        <p>{bootstrap.message}</p>
        <LoaderCircle className="spin" />
      </main>
    );
  if (bootstrap.failed)
    return (
      <main className="startup failed">
        <div className="brand-orbit">
          <strong>!</strong>
        </div>
        <h1>
          {bootstrap.phase === "bootstrap_failed"
            ? "数据加载失败"
            : bootstrap.phase === "settling_referral"
              ? "邀请关系确认中"
              : "无法进入游戏"}
        </h1>
        <p>{bootstrap.message}</p>
        {bootstrap.canRetry ? (
          <Button onClick={bootstrap.retry} disabled={!bootstrap.canRetry}>
            <RotateCw />
            {bootstrap.retryLabel}
          </Button>
        ) : null}
      </main>
    );
  if (!session)
    return (
      <main className="startup failed">
        <div className="brand-orbit">
          <strong>!</strong>
        </div>
        <h1>会话已失效</h1>
        <p>请重新从 Telegram 打开 Mini App</p>
      </main>
    );
  return (
    <AccountGate restricted={false}>
      <AppRouter />
      {bootstrap.notice ? (
        <EntryNotice key={bootstrap.notice} message={bootstrap.notice} />
      ) : null}
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
    <main className="startup failed">
      <div className="brand-orbit">
        <strong>!</strong>
      </div>
      <h1>数据加载失败</h1>
      <p>数据加载失败，请重试。</p>
      <Button
        disabled={submitting}
        onClick={() => {
          setSubmitting(true);
          void retryRecoveredBootstrap()
            .catch(() => undefined)
            .finally(() => setSubmitting(false));
        }}
      >
        <RotateCw />
        重新尝试
      </Button>
    </main>
  );
}
