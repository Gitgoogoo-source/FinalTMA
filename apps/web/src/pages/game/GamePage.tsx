import type { ReactNode } from "react";

import { BattleView } from "../../domains/battle/index.ts";

export function GamePage(): ReactNode {
  return (
    <main className="page game-page" aria-label="Battle">
      <BattleView />
    </main>
  );
}
