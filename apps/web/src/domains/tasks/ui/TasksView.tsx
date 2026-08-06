import {
  BadgeCheck,
  BookOpen,
  Boxes,
  CalendarDays,
  Check,
  Circle,
  CircleDollarSign,
  Copy,
  Grid3X3,
  Link2,
  LockKeyhole,
  Map as MapIcon,
  PackageOpen,
  PackageX,
  RotateCw,
  Send,
  ShipWheel,
  ShoppingBasket,
  Sparkle,
  Sparkles,
  Tag,
  TicketCheck,
  Triangle,
  Trophy,
  UsersRound,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
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
import {
  getAppScrollTop,
  scrollAppTo,
} from "../../../shared/navigation/appScroll.ts";
import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import {
  isVisibleMvpTask,
  type Task,
  type VisibleTaskCategory,
} from "../visibility.ts";

type TaskFilter = "all" | VisibleTaskCategory;
type TaskViewState = { category: TaskFilter; scrollY: number };

const viewStates = new Map<string, TaskViewState>();
let viewStateEpoch = 0;
registerSensitiveStateResetter(() => {
  viewStateEpoch += 1;
  viewStates.clear();
});

const taskCategoryLabels: Record<VisibleTaskCategory, string> = {
  gacha: "开盒",
  daily: "每日",
  social: "社交",
  market: "交易",
  inventory: "藏品",
  album: "图鉴",
};
const taskFilters: ReadonlyArray<{ key: TaskFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "daily", label: "每日" },
  { key: "gacha", label: "开盒" },
  { key: "social", label: "社交" },
  { key: "market", label: "交易" },
  { key: "inventory", label: "藏品" },
  { key: "album", label: "图鉴" },
] as const;
const taskStatusLabels: Record<Task["status"], string> = {
  not_started: "未开始",
  in_progress: "进行中",
  claimable: "可领取",
  claimed: "已领取",
};

const taskCodeIcons: Record<Task["code"], LucideIcon> = {
  gacha_1: PackageOpen,
  gacha_10: Boxes,
  gacha_ten: Grid3X3,
  wheel_spin: ShipWheel,
  copy_referral: Copy,
  telegram_invite: Send,
  market_buy: ShoppingBasket,
  market_list: Tag,
  market_sold: CircleDollarSign,
  evolution_success: Sparkles,
  evolution_attempt: RotateCw,
  decompose: PackageX,
  expedition_normal: MapIcon,
  expedition_intermediate: Waypoints,
  expedition_advanced: Trophy,
  album_unlock: BookOpen,
  album_chain: Link2,
  wallet_verified: BadgeCheck,
  mint_success: TicketCheck,
};
const checkInRewards = [
  { amount: "20", unit: "Fgems", kind: "fgems" },
  { amount: "30", unit: "Fgems", kind: "fgems" },
  { amount: "50", unit: "Fgems", kind: "fgems" },
  { amount: "80", unit: "Fgems", kind: "fgems" },
  { amount: "100", unit: "Fgems", kind: "fgems" },
  { amount: "150", unit: "Fgems", kind: "fgems" },
  { amount: "1", unit: "稀有盒资格", kind: "box" },
] as const;

function TaskIconArtwork({ taskCode }: { taskCode: Task["code"] }): ReactNode {
  if (taskCode === "gacha_1") {
    return (
      <div className="task-icon task-icon--calendar-sparkle" aria-hidden="true">
        <CalendarDays className="task-icon-main" />
        <Sparkle className="task-icon-calendar-star" />
        <Sparkles className="task-icon-detail" />
      </div>
    );
  }
  if (taskCode === "gacha_10") {
    return (
      <div className="task-icon task-icon--grid-ten" aria-hidden="true">
        <Grid3X3 className="task-icon-main" />
        <span className="task-icon-ten-label">10</span>
      </div>
    );
  }
  if (taskCode === "gacha_ten") {
    return (
      <div className="task-icon task-icon--calendar-link" aria-hidden="true">
        <CalendarDays className="task-icon-calendar task-icon-calendar--left" />
        <Link2 className="task-icon-link" />
        <CalendarDays className="task-icon-calendar task-icon-calendar--right" />
      </div>
    );
  }
  if (taskCode === "wheel_spin") {
    return (
      <div className="task-icon task-icon--wheel" aria-hidden="true">
        <ShipWheel className="task-icon-main" />
        <Triangle className="task-icon-pointer" />
      </div>
    );
  }
  if (taskCode === "copy_referral") {
    return (
      <div className="task-icon task-icon--user-link" aria-hidden="true">
        <UsersRound className="task-icon-main" />
        <Link2 className="task-icon-detail" />
      </div>
    );
  }
  const TaskIcon = taskCodeIcons[taskCode];
  return (
    <div className="task-icon task-icon--single" aria-hidden="true">
      <TaskIcon className="task-icon-main" />
    </div>
  );
}

export function TasksView({
  afterCheckIn,
}: {
  afterCheckIn: ReactNode;
}): ReactNode {
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
  const items = (tasks.data?.tasks ?? []).filter(isVisibleMvpTask);
  const visibleItems =
    category === "all" || category === "daily"
      ? items
      : items.filter((task) => task.category === category);
  const cycleProgress = tasks.data?.checkin.cycle_progress ?? 0;
  const claimedToday = Boolean(tasks.data?.checkin.claimed_today);
  const currentCheckInDay = Math.min(
    7,
    claimedToday ? Math.max(1, cycleProgress) : cycleProgress + 1,
  );
  useEffect(() => {
    categoryRef.current = category;
  }, [category]);
  useLayoutEffect(() => {
    if (scrollRestored.current || tasks.isLoading) return;
    const frame = window.requestAnimationFrame(() => {
      scrollAppTo(restoreScrollY.current);
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
        scrollY: getAppScrollTop(),
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
            <div>
              <span>7 日签到</span>
            </div>
            <Button
              id="task-checkin-action"
              disabled={blocked || checkingIn || claimedToday}
              onClick={() => void checkIn()}
            >
              {claimedToday ? "今日已签到" : checkingIn ? "领取中" : "立即签到"}
            </Button>
          </div>
          <div className="checkin-progress" aria-hidden="true">
            {checkInRewards.map((_, index) => {
              const day = index + 1;
              return (
                <span
                  key={day}
                  className={`${day <= cycleProgress ? "claimed" : ""} ${day === currentCheckInDay ? "active" : ""}`}
                >
                  <i>{day}</i>
                </span>
              );
            })}
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
                  aria-label={`第 ${day} 天，${reward.amount} ${reward.unit}，${claimed ? "已领取" : active ? "当前待领取" : "未解锁"}`}
                >
                  <small>第 {day} 天</small>
                  <span className="checkin-reward-art">
                    {reward.kind === "box" ? (
                      <img
                        className="checkin-box-image"
                        src="/assets/boxes/rare.webp"
                        alt=""
                      />
                    ) : (
                      <img
                        className="checkin-fgems-image"
                        src="/assets/tasks/checkin-fgems-v2.png"
                        alt=""
                      />
                    )}
                  </span>
                  <span className="checkin-reward-copy">
                    <strong>{reward.amount}</strong>
                    <em>{reward.unit}</em>
                  </span>
                  {claimed ? (
                    <Check className="checkin-state-icon" aria-hidden="true" />
                  ) : active ? (
                    <Circle className="checkin-state-icon" aria-hidden="true" />
                  ) : (
                    <LockKeyhole className="checkin-lock" aria-hidden="true" />
                  )}
                </span>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="task-wheel">{afterCheckIn}</div>
      <nav
        id="task-filters"
        className="task-filter-strip"
        aria-label="任务分类"
      >
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
            <Card key={task.code} className={`task-row ${task.status}`}>
              <TaskIconArtwork taskCode={task.code} />
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
    wheel: "/tasks?focus=wheel",
    market_buy: "/market?tab=buy&focus=market-buy",
    market_sell: "/market?tab=sell&focus=market-sell",
    market_manage: "/market?tab=manage&focus=market-manage",
    inventory_evolution: "/inventory?focus=evolution",
    inventory_decomposition: "/inventory?focus=decomposition",
    album: "/album",
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
