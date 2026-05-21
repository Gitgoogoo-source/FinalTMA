import { env } from "@/env";

import { AppProviders } from "./providers/AppProviders";

export function App() {
  return (
    <AppProviders>
      <main className="phase-shell">
        <section className="phase-panel" aria-labelledby="phase-title">
          <p className="phase-kicker">第一阶段</p>
          <h1 id="phase-title" className="phase-title">
            盲盒小游戏
          </h1>
          <p className="phase-copy">
            基础前端入口已启动，下一步会继续接入公开环境变量校验。
          </p>
          <div className="phase-meta" aria-label="运行信息">
            <span className="phase-pill">{env.APP_ENV}</span>
            <span className="phase-pill">{env.API_BASE_URL}</span>
          </div>
        </section>
      </main>
    </AppProviders>
  );
}
