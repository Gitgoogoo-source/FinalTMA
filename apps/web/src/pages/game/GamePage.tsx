import { Gamepad2 } from "lucide-react";
import type { ReactNode } from "react";

import { ExpeditionPanel } from "../../domains/expedition/index.ts";
import { MonsterTamerPanel } from "../../domains/monster-tamer/index.ts";
import { WheelPanel } from "../../domains/wheel/index.ts";

export function GamePage(): ReactNode {
  return (
    <main className="page game-page">
      <header className="page-heading game-heading">
        <div>
          <span>DAILY GAME</span>
          <h1>游戏中心</h1>
        </div>
        <Gamepad2 aria-hidden="true" />
      </header>
      <div className="game-stack">
        <MonsterTamerPanel />
        <ExpeditionPanel />
        <WheelPanel />
      </div>
    </main>
  );
}
