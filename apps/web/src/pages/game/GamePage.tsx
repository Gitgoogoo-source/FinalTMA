import type { ReactNode } from "react";

import { MonsterTamerHome } from "../../domains/monster-tamer/index.ts";

export function GamePage(): ReactNode {
  return (
    <main className="page game-page monster-home-page">
      <MonsterTamerHome />
    </main>
  );
}
