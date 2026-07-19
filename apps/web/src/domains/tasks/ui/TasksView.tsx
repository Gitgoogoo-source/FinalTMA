import { CalendarCheck, Gift } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

const taskCategories = [
  "全部",
  "每日",
  "开盒",
  "社交",
  "交易",
  "藏品",
  "远征",
  "图鉴",
  "钱包",
  "链上",
] as const;

const checkInRewards = ["20", "30", "50", "80", "100", "150", "稀有盒"];

export function TasksView(): ReactNode {
  const tasks = useApiQuery("tasks.get");
  const { isBlocked, run } = useOperationRegistry();
  const [category, setCategory] =
    useState<(typeof taskCategories)[number]>("全部");
  const blocked = isBlocked("tasks.check_in") || isBlocked("tasks.claim");
  const checkIn = () => void run("正在确认今日签到", "tasks.check_in", {});
  const claim = (taskCode: string) =>
    void run("正在领取任务奖励", "tasks.claim", { task_code: taskCode });
  const items = tasks.data?.tasks ?? [];
  const visibleItems =
    category === "全部" || category === "每日"
      ? items
      : items.filter((task) => task.category === category);
  const cycleProgress = tasks.data?.checkin.cycle_progress ?? 0;
  const claimedToday = Boolean(tasks.data?.checkin.claimed_today);
  return (
    <PageState
      loading={tasks.isLoading}
      error={tasks.error as Error | null}
      onRetry={() => void tasks.refetch()}
      empty={false}
    >
      <Card className="checkin-card">
        <div className="checkin-heading">
          <span className="checkin-icon">
            <CalendarCheck aria-hidden="true" />
          </span>
          <div>
            <span>七日签到</span>
            <strong>
              本轮签到：第 {tasks.data?.checkin.next_day ?? 1} 天 / 7 天
            </strong>
          </div>
          <Button disabled={blocked || claimedToday} onClick={checkIn}>
            {claimedToday ? "今日已签到" : "立即签到"}
          </Button>
        </div>
        <div className="checkin-days" role="list" aria-label="七日签到奖励">
          {checkInRewards.map((reward, index) => {
            const day = index + 1;
            const claimed = day <= cycleProgress;
            const active = !claimedToday && day === cycleProgress + 1;
            return (
              <span
                key={day}
                role="listitem"
                className={`${claimed ? "claimed" : ""} ${active ? "active" : ""}`}
              >
                <small>DAY {day}</small>
                <i>{claimed ? "✓" : day === 7 ? "◇" : "✦"}</i>
                <strong>{reward}</strong>
              </span>
            );
          })}
        </div>
      </Card>
      <nav className="task-filter-strip" aria-label="任务分类">
        {taskCategories.map((item) => (
          <button
            key={item}
            className={category === item ? "active" : ""}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="task-list">
        {visibleItems.map((task) => {
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
                  <span>
                    {task.progress} / {task.target}
                  </span>
                  <strong>+{task.reward_fgems} Fgems</strong>
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
  );
}
