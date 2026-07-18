import type { ReactNode } from "react";

import { WheelPanel } from "../wheel/WheelPanel.tsx";
import { ExpeditionPanel } from "./ExpeditionPanel.tsx";

export function GamePage(): ReactNode {
  return (
    <main className="page">
      <header className="hero game-hero">
        <span>DAILY GAME</span>
        <h1>游戏中心</h1>
        <p>每项结果独立确认，一项加载失败不会阻止另一项。</p>
      </header>
      <div className="game-stack">
        <ExpeditionPanel />
        <WheelPanel />
      </div>
    </main>
  );
}
