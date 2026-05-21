import { env } from "@/env";

import { RequireSession } from "./guards/RequireSession";
import { AppProviders } from "./providers/AppProviders";
import { useSession } from "./providers/SessionProvider";

export function App() {
  return (
    <AppProviders>
      <RequireSession>
        <AuthenticatedHome />
      </RequireSession>
    </AppProviders>
  );
}

function AuthenticatedHome() {
  const session = useSession();
  const displayName = session.user?.firstName ?? "玩家";

  return (
    <main className="phase-shell">
      <section className="phase-panel" aria-labelledby="phase-title">
        <p className="phase-kicker">第一阶段</p>
        <h1 id="phase-title" className="phase-title">
          盲盒小游戏
        </h1>
        <p className="phase-copy">
          {displayName}，Telegram 登录已完成，前端 Provider 和认证链路已接入。
        </p>
        <div className="phase-meta" aria-label="运行信息">
          <span className="phase-pill">{env.APP_ENV}</span>
          <span className="phase-pill">{env.API_BASE_URL}</span>
          <span className="phase-pill">
            bootstrap: {session.bootstrapStatus}
          </span>
        </div>
      </section>
    </main>
  );
}
