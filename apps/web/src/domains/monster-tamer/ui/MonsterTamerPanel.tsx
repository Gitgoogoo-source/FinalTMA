import { PawPrint, Play } from "lucide-react";
import { useState, type ReactNode } from "react";

import { MonsterTamerHome } from "./MonsterTamerHome.tsx";

export function MonsterTamerPanel(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="card game-panel monster-tamer-panel">
        <div className="panel-title">
          <PawPrint aria-hidden="true" />
          <div>
            <span>MONSTER HOME</span>
            <h2>Monster Tamer</h2>
          </div>
        </div>
        <p>让你真实拥有的 Monster 在 50×50 水上家园中自由活动。</p>
        <button
          className="monster-tamer-launch"
          type="button"
          onClick={() => setOpen(true)}
        >
          <Play aria-hidden="true" />
          进入家园
        </button>
      </section>
      {open ? <MonsterTamerHome onClose={() => setOpen(false)} /> : null}
    </>
  );
}
