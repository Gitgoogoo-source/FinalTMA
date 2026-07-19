import { LoaderCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../shared/ui/index.tsx";
import { useSession } from "../platform/session/store.ts";
import { useBootstrap } from "../workflows/session-bootstrap/index.ts";
import { AccountGate } from "./guards/AccountGate.tsx";
import { AppRouter } from "./router/AppRouter.tsx";

export function App(): ReactNode {
  const bootstrap = useBootstrap();
  const session = useSession();
  if (bootstrap.phase === "banned" || session?.accountStatus === "banned")
    return <AccountGate restricted />;
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
  if (bootstrap.phase === "loading")
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
  if (bootstrap.phase === "failed")
    return (
      <main className="startup failed">
        <div className="brand-orbit">
          <strong>!</strong>
        </div>
        <h1>无法进入游戏</h1>
        <p>{bootstrap.message}</p>
        {bootstrap.message.includes("网络") ||
        bootstrap.message.includes("稍后") ? (
          <Button onClick={bootstrap.retry}>
            <RotateCw />
            重新尝试
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
    </AccountGate>
  );
}
