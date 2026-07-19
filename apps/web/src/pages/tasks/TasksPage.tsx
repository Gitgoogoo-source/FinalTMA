import { Check, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ReferralPanel } from "../../domains/referral/index.ts";
import { TasksView } from "../../domains/tasks/index.ts";

export function TasksPage(): ReactNode {
  const [tab, setTab] = useState<"tasks" | "referral">("tasks");
  return (
    <main className="page">
      <header className="hero tasks-hero">
        <span>DAILY MISSIONS</span>
        <h1>任务中心</h1>
        <p>任务事实与奖励由同一数据库事务确认。</p>
      </header>
      <nav className="segmented">
        <button
          className={tab === "tasks" ? "active" : ""}
          onClick={() => setTab("tasks")}
        >
          <Check />
          任务与签到
        </button>
        <button
          className={tab === "referral" ? "active" : ""}
          onClick={() => setTab("referral")}
        >
          <Users />
          分享邀请
        </button>
      </nav>
      {tab === "tasks" ? <TasksView /> : <ReferralPanel />}
    </main>
  );
}
