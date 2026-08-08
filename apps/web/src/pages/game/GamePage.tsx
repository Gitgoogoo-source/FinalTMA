import type { ReactNode } from "react";

import { BattleView } from "../../domains/battle/index.ts";
import "../../shared/styles/game-page.css";

export function GamePage(): ReactNode {
  return (
    <main className="page game-page" aria-label="Battle">
      <BattleView />
    </main>
  );
}
