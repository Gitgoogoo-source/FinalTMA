import { CalendarCheck, Check, Gift, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { number, records, text } from "../../shared/lib/data.ts";
import { Badge, Button, Card, PageState } from "../../shared/ui/index.tsx";
import { ReferralPanel } from "../referral/ReferralPanel.tsx";

export function TasksPage(): ReactNode {
  const [tab, setTab] = useState<"tasks" | "referral">("tasks");
  const tasks = useApiQuery("tasks.overview", {}, tab === "tasks");
  const checkin = useApiQuery("tasks.check_in_status", {}, tab === "tasks");
  const { blocked, run } = useOperation();
  const act = (route: string, input: Record<string, unknown>, label: string) =>
    void run(label, async () => {
      const response = await apiRequest(route, input, {
        idempotencyKey: newIdempotencyKey(),
      });
      return { data: response.data, operationId: response.operationId };
    });
  const items = records(tasks.data?.tasks);
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
          loading={tasks.isLoading || checkin.isLoading}
          error={(tasks.error ?? checkin.error) as Error | null}
          onRetry={() => {
            void tasks.refetch();
            void checkin.refetch();
          }}
          empty={false}
        >
          <Card className="checkin-card">
            <div>
              <CalendarCheck />
              <span>连续签到</span>
              <strong>第 {text(checkin.data?.next_day)} 天</strong>
            </div>
            <Button
              disabled={blocked || Boolean(checkin.data?.claimed_today)}
              onClick={() => act("tasks.check_in", {}, "正在确认今日签到")}
            >
              {checkin.data?.claimed_today ? "今日已签到" : "立即签到"}
            </Button>
          </Card>
          <div className="task-list">
            {items.map((task) => {
              const complete = number(task.progress) >= number(task.target);
              return (
                <Card key={text(task.code)} className="task-row">
                  <div className="task-icon">
                    <Gift />
                  </div>
                  <div>
                    <Badge>{text(task.category)}</Badge>
                    <h3>{text(task.name)}</h3>
                    <p>
                      {text(task.progress)} / {text(task.target)} · 奖励{" "}
                      {text(task.reward_fgems)} Fgems
                    </p>
                    <div className="meter">
                      <i
                        style={{
                          width: `${Math.min(100, (number(task.progress) / Math.max(1, number(task.target))) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <Button
                    disabled={blocked || !complete || Boolean(task.claimed)}
                    onClick={() =>
                      act(
                        "tasks.claim",
                        { task_code: task.code },
                        "正在领取任务奖励",
                      )
                    }
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
