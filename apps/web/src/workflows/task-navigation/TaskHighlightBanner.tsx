import type { RouteOutput } from "@pokepets/api-contracts/app";
import {
  BookOpen,
  CalendarCheck,
  Gift,
  ListChecks,
  Send,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useApiQuery } from "../../platform/query/index.ts";
import { focusTaskTarget } from "../../shared/navigation/focusTaskTarget.ts";
import { Button, Card } from "../../shared/ui/index.tsx";
import { useOperationRegistry } from "../operation-recovery/index.ts";

type Task = RouteOutput<"tasks.get">["tasks"][number];
type Highlight = {
  kind: "checkin" | "claim" | "task" | "referral" | "wheel" | "album";
  title: string;
  description: string;
  action: string;
  task?: Task;
};

export function TaskHighlightBanner(): ReactNode {
  const navigate = useNavigate();
  const tasks = useApiQuery("tasks.get");
  const referral = useApiQuery("referral.get");
  const { isBlocked } = useOperationRegistry();
  const orderedTasks = tasks.data?.tasks ?? [];
  const claimable = orderedTasks.find((task) => task.status === "claimable");
  const unfinished = orderedTasks.find(
    (task) => task.status === "not_started" || task.status === "in_progress",
  );
  const needsFallback = Boolean(
    tasks.data?.checkin.claimed_today && !claimable && !unfinished,
  );
  const referralAvailable =
    Boolean(referral.data) && !isBlocked("referral.share_event");
  const needsWheel =
    needsFallback &&
    !referralAvailable &&
    (referral.data !== undefined || referral.isError);
  const wheel = useApiQuery("wheel.get", {}, needsWheel);
  const album = useApiQuery("album.get", {}, needsWheel && wheel.isError);
  const highlight = selectHighlight(
    tasks.data,
    claimable,
    unfinished,
    referralAvailable,
    wheel.data !== undefined,
    album.data !== undefined,
  );
  if (!highlight) return null;
  const Icon =
    highlight.kind === "checkin"
      ? CalendarCheck
      : highlight.kind === "claim"
        ? Gift
        : highlight.kind === "task"
          ? ListChecks
          : highlight.kind === "referral"
            ? Send
            : highlight.kind === "wheel"
              ? Sparkles
              : BookOpen;
  const activate = () => {
    if (highlight.kind === "checkin") {
      focusTaskTarget(document.getElementById("task-checkin-action"));
      return;
    }
    if (highlight.kind === "claim" && highlight.task) {
      focusTaskTarget(
        document.getElementById(`task-card-${highlight.task.code}-action`),
      );
      return;
    }
    if (highlight.kind === "task" && highlight.task) {
      focusTaskTarget(
        document.getElementById(`task-card-${highlight.task.code}`),
      );
      return;
    }
    if (highlight.kind === "referral") {
      focusTaskTarget(document.getElementById("task-referral"));
      return;
    }
    navigate(highlight.kind === "wheel" ? "/game?focus=wheel" : "/album");
  };
  return (
    <Card className={`task-highlight ${highlight.kind}`}>
      <span className="task-highlight-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <small>今日重点</small>
        <strong>{highlight.title}</strong>
        <p>{highlight.description}</p>
      </div>
      <Button onClick={activate}>{highlight.action}</Button>
    </Card>
  );
}

function selectHighlight(
  data: RouteOutput<"tasks.get"> | undefined,
  claimable: Task | undefined,
  unfinished: Task | undefined,
  referralAvailable: boolean,
  wheelAvailable: boolean,
  albumAvailable: boolean,
): Highlight | null {
  if (!data) return null;
  if (!data.checkin.claimed_today)
    return {
      kind: "checkin",
      title: "今日签到可领取",
      description: `领取本轮第 ${data.checkin.next_day} 天签到奖励`,
      action: "去签到",
    };
  if (claimable)
    return {
      kind: "claim",
      title: "任务奖励待领取",
      description: claimable.title,
      action: "去领取",
      task: claimable,
    };
  if (unfinished)
    return {
      kind: "task",
      title: "继续今日任务",
      description: unfinished.title,
      action: "去完成",
      task: unfinished,
    };
  if (referralAvailable)
    return {
      kind: "referral",
      title: "邀请好友一起开盲盒",
      description: "复制邀请链接或打开 Telegram 分享",
      action: "去邀请",
    };
  if (wheelAvailable)
    return {
      kind: "wheel",
      title: "幸运转盘",
      description: "前往游戏页查看今日转盘状态",
      action: "去转盘",
    };
  if (albumAvailable)
    return {
      kind: "album",
      title: "进化图鉴",
      description: "查看永久点亮与图鉴链进度",
      action: "去图鉴",
    };
  return null;
}
