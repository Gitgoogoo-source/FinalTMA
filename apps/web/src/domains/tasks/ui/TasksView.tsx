import { CalendarCheck, Check, Gift, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { ReferralPanel } from "../../referral/index.ts";

export function TasksView(): ReactNode {
  const [tab, setTab] = useState<"tasks" | "referral">("tasks");
  const tasks = useApiQuery("tasks.get", {}, tab === "tasks");
  const { isBlocked, run } = useOperationRegistry();
  const blocked = isBlocked("tasks.check_in") || isBlocked("tasks.claim");
  const checkIn = () => void run("正在确认今日签到", "tasks.check_in", {});
  const claim = (taskCode: string) =>
    void run("正在领取任务奖励", "tasks.claim", { task_code: taskCode });
  const items = tasks.data?.tasks ?? [];
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
      {tab === "referral" ? (
        <ReferralPanel />
      ) : (
        <PageState
          loading={tasks.isLoading}
          error={tasks.error as Error | null}
          onRetry={() => void tasks.refetch()}
          empty={false}
        >
          <Card className="checkin-card">
            <div>
              <CalendarCheck />
              <span>连续签到</span>
              <strong>第 {tasks.data?.checkin.next_day ?? 1} 天</strong>
            </div>
            <Button
              disabled={blocked || Boolean(tasks.data?.checkin.claimed_today)}
              onClick={checkIn}
            >
              {tasks.data?.checkin.claimed_today ? "今日已签到" : "立即签到"}
            </Button>
          </Card>
          <div className="task-list">
            {items.map((task) => {
              const complete = task.progress >= task.target;
              return (
                <Card key={task.code} className="task-row">
                  <div className="task-icon">
                    <Gift />
                  </div>
                  <div>
                    <Badge>{task.category}</Badge>
                    <h3>{task.name}</h3>
                    <p>
                      {task.progress} / {task.target} · 奖励 {task.reward_fgems}{" "}
                      Fgems
                    </p>
                    <div className="meter">
                      <i
                        style={{
                          width: `${Math.min(100, (task.progress / Math.max(1, task.target)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <Button
                    disabled={blocked || !complete || Boolean(task.claimed)}
                    onClick={() => claim(task.code)}
                  >
                    {task.claimed ? "已领取" : complete ? "领取" : "进行中"}
                  </Button>
                </Card>
              );
            })}
          </div>
        </PageState>
      )}
    </main>
  );
}
