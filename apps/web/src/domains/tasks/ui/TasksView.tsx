import type { RouteOutput } from "@pokepets/api-contracts/app";
import { CalendarCheck, Gift } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { useApiQuery } from "../../../platform/query/index.ts";
import {
  registerSensitiveStateResetter,
  useSession,
} from "../../../platform/session/store.ts";
import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

type Task = RouteOutput<"tasks.get">["tasks"][number];
type TaskCategory = Task["category"];
type TaskFilter = "all" | TaskCategory;
type TaskViewState = { category: TaskFilter; scrollY: number };

const viewStates = new Map<string, TaskViewState>();
let viewStateEpoch = 0;
registerSensitiveStateResetter(() => {
  viewStateEpoch += 1;
  viewStates.clear();
});

const taskCategoryLabels: Record<TaskCategory, string> = {
  gacha: "开盒",
  daily: "每日",
  social: "社交",
  market: "交易",
  inventory: "藏品",
  expedition: "远征",
  album: "图鉴",
  wallet: "钱包",
  mint: "链上",
};
const taskFilters: ReadonlyArray<{ key: TaskFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "daily", label: "每日" },
  { key: "gacha", label: "开盒" },
  { key: "social", label: "社交" },
  { key: "market", label: "交易" },
  { key: "inventory", label: "藏品" },
  { key: "expedition", label: "远征" },
  { key: "album", label: "图鉴" },
  { key: "wallet", label: "钱包" },
  { key: "mint", label: "链上" },
] as const;
const taskStatusLabels: Record<Task["status"], string> = {
  not_started: "未开始",
  in_progress: "进行中",
  claimable: "可领取",
  claimed: "已领取",
};

const checkInRewards = ["20", "30", "50", "80", "100", "150", "稀有盒"];

export function TasksView(): ReactNode {
  const tasks = useApiQuery("tasks.get");
  const { isBlocked, run } = useOperationRegistry();
  const navigate = useNavigate();
  const session = useSession();
  const remembered = session ? viewStates.get(session.userId) : undefined;
  const [category, setCategory] = useState<TaskFilter>(
    remembered?.category ?? "all",
  );
  const categoryRef = useRef(category);
  const rememberedScrollY = remembered?.scrollY ?? 0;
  const restoreScrollY = useRef(rememberedScrollY);
  const scrollRestored = useRef(rememberedScrollY === 0);
  const [checkingIn, setCheckingIn] = useState(false);
  const [claimingCode, setClaimingCode] = useState<Task["code"] | null>(null);
  const blocked = isBlocked("tasks.check_in") || isBlocked("tasks.claim");
  const checkIn = async () => {
    setCheckingIn(true);
    try {
      await run("正在确认今日签到", "tasks.check_in", {});
    } finally {
      setCheckingIn(false);
    }
  };
  const claim = async (taskCode: Task["code"]) => {
    setClaimingCode(taskCode);
    try {
      await run("正在领取任务奖励", "tasks.claim", {
        task_code: taskCode,
      });
    } finally {
      setClaimingCode(null);
    }
  };
  const items = tasks.data?.tasks ?? [];
  const visibleItems =
    category === "all" || category === "daily"
      ? items
      : items.filter((task) => task.category === category);
  const cycleProgress = tasks.data?.checkin.cycle_progress ?? 0;
  const claimedToday = Boolean(tasks.data?.checkin.claimed_today);
  useEffect(() => {
    categoryRef.current = category;
  }, [category]);
  useLayoutEffect(() => {
    if (scrollRestored.current || tasks.isLoading) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: restoreScrollY.current,
        left: 0,
        behavior: "auto",
      });
      scrollRestored.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tasks.isLoading, visibleItems.length]);
  useLayoutEffect(() => {
    if (!session) return;
    const epoch = viewStateEpoch;
    const userId = session.userId;
    return () => {
      if (epoch !== viewStateEpoch) return;
      viewStates.set(userId, {
        category: categoryRef.current,
        scrollY: Math.max(0, window.scrollY),
      });
    };
  }, [session]);
  return (
    <PageState
      loading={tasks.isLoading}
      error={tasks.error as Error | null}
      onRetry={() => void tasks.refetch()}
      empty={false}
    >
      <div id="task-checkin" tabIndex={-1}>
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
            <Button
              id="task-checkin-action"
              disabled={blocked || checkingIn || claimedToday}
              onClick={() => void checkIn()}
            >
              {claimedToday ? "今日已签到" : checkingIn ? "领取中" : "立即签到"}
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
      </div>
      <nav className="task-filter-strip" aria-label="任务分类">
        {taskFilters.map((item) => (
          <button
            key={item.key}
            className={category === item.key ? "active" : ""}
            aria-pressed={category === item.key}
            onClick={() => setCategory(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="task-list">
        {visibleItems.map((task) => {
          const claiming = claimingCode === task.code;
          const canClaim = task.status === "claimable";
          const canComplete =
            task.status === "not_started" || task.status === "in_progress";
          return (
            <Card key={task.code} className="task-row">
              <div className="task-icon">
                <Gift aria-hidden="true" />
              </div>
              <div id={`task-card-${task.code}`} tabIndex={-1}>
                <div className="task-card-meta">
                  <Badge>{taskCategoryLabels[task.category]}</Badge>
                  <span className={`task-status ${task.status}`}>
                    {claiming ? "领取中" : taskStatusLabels[task.status]}
                  </span>
                </div>
                <h3>{task.title}</h3>
                <p className="task-description">{task.description}</p>
                <p className="task-progress">
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
                id={`task-card-${task.code}-action`}
                disabled={blocked || claiming || task.status === "claimed"}
                onClick={() => {
                  if (canClaim) void claim(task.code);
                  else if (canComplete)
                    goComplete(task.completion_action, navigate);
                }}
              >
                {claiming
                  ? "领取中"
                  : canClaim
                    ? "领取"
                    : canComplete
                      ? "去完成"
                      : "已领取"}
              </Button>
            </Card>
          );
        })}
      </div>
    </PageState>
  );
}

function goComplete(
  action: Task["completion_action"],
  navigate: ReturnType<typeof useNavigate>,
): void {
  const routes: Partial<Record<Task["completion_action"], string>> = {
    gacha_single: "/?focus=gacha-single",
    gacha_ten: "/?focus=gacha-ten",
    wheel: "/game?focus=wheel",
    market_buy: "/market?tab=buy&focus=market-buy",
    market_sell: "/market?tab=sell&focus=market-sell",
    market_manage: "/market?tab=manage&focus=market-manage",
    inventory_evolution: "/inventory?focus=evolution",
    inventory_decomposition: "/inventory?focus=decomposition",
    expedition_normal: "/game?focus=expedition-normal",
    expedition_intermediate: "/game?focus=expedition-intermediate",
    expedition_advanced: "/game?focus=expedition-advanced",
    album: "/album",
    wallet: "/tasks?dialog=wallet",
    inventory_mint: "/inventory?focus=mint",
  };
  if (action === "referral_copy") {
    focusTaskTarget(document.getElementById("task-referral-copy"));
    return;
  }
  if (action === "referral_telegram") {
    focusTaskTarget(document.getElementById("task-referral-telegram"));
    return;
  }
  const route = routes[action];
  if (route) navigate(route);
}
