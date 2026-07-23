import { PawPrint, Play } from "lucide-react";
import type { ReactNode } from "react";

export function MonsterTamerPanel(): ReactNode {
  return (
    <section className="card game-panel monster-tamer-panel">
      <div className="panel-title">
        <PawPrint aria-hidden="true" />
        <div>
          <span>MONSTER TAMER</span>
          <h2>Monster Tamer</h2>
        </div>
      </div>
      <p>探索独立怪兽世界，驯服怪兽并完成冒险。</p>
      <a className="monster-tamer-launch" href="/monster-tamer/">
        <Play aria-hidden="true" />
        进入游戏
      </a>
    </section>
  );
}
