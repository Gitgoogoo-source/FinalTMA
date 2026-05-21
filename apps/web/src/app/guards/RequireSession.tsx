import type { ReactNode } from "react";

import { useSession } from "../providers/SessionProvider";

type RequireSessionProps = {
  children: ReactNode;
};

export function RequireSession({ children }: RequireSessionProps) {
  const session = useSession();

  if (session.status === "authenticated") {
    return <>{children}</>;
  }

  if (session.status === "authenticating" || session.status === "idle") {
    return (
      <main className="phase-shell">
        <section className="phase-panel" aria-live="polite">
          <p className="phase-kicker">登录中</p>
          <h1 className="phase-title">正在验证 Telegram 身份</h1>
          <p className="phase-copy">请保持在 Telegram Mini App 内打开页面。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="phase-shell">
      <section className="phase-panel" role="alert">
        <p className="phase-kicker">登录失败</p>
        <h1 className="phase-title">无法完成自动登录</h1>
        <p className="phase-copy">
          {session.error?.message ?? "请从 Telegram 重新打开应用。"}
        </p>
        <button
          className="phase-button"
          onClick={() => void session.authenticate()}
          type="button"
        >
          重新登录
        </button>
      </section>
    </main>
  );
}
