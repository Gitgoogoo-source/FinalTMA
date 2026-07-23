import { PawPrint, Play } from "lucide-react";
import { useState, type ReactNode } from "react";

import { MonsterTamerOverlay } from "./MonsterTamerOverlay.tsx";

export function MonsterTamerPanel(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="card game-panel monster-tamer-panel">
        <div className="panel-title">
          <PawPrint aria-hidden="true" />
          <div>
            <span>MONSTER TAMER</span>
            <h2>Monster Tamer</h2>
          </div>
        </div>
        <p>带上你的真实藏品，探索五个生态区域并挑战最终守护者。</p>
        <button
          className="monster-tamer-launch"
          type="button"
          onClick={() => setOpen(true)}
        >
          <Play aria-hidden="true" />
          进入游戏
        </button>
      </section>
      {open ? <MonsterTamerOverlay onClose={() => setOpen(false)} /> : null}
    </>
  );
}
